import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  getConfig,
  hasGooglePhotosConfig,
  isAllowedChatId,
  type AppConfig,
} from "../../lib/config.js";
import {
  appendDailyEntry,
  buildNotePaths,
  createRawNote,
  getTimestampParts,
} from "../../lib/daily-note.js";
import { uploadTelegramPhotoToGooglePhotos } from "../../lib/google-photos.js";
import { createTextFileIfMissing, updateTextFile } from "../../lib/github.js";
import {
  getLargestPhoto,
  getIncomingMessage,
  getMessageText,
  getSenderLabel,
  sendTelegramMessage,
  type TelegramMessage,
  type TelegramUpdate,
} from "../../lib/telegram.js";

function readSecretHeader(req: VercelRequest): string {
  const value = req.headers["x-telegram-bot-api-secret-token"];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parseUpdate(body: unknown): TelegramUpdate {
  if (typeof body === "string") {
    return JSON.parse(body) as TelegramUpdate;
  }

  if (!body || typeof body !== "object") {
    throw new Error("Invalid Telegram payload");
  }

  return body as TelegramUpdate;
}

function formatSuccessReply({
  dailyPath,
  dailyResult,
  contentKind,
}: {
  dailyPath: string;
  dailyResult: "created" | "updated" | "unchanged";
  contentKind: "text" | "photo";
}) {
  const headline = contentKind === "photo" ? "사진 저장 완료" : "저장 완료";

  if (dailyResult === "unchanged") {
    return `이미 저장된 메시지입니다.\n${dailyPath}`;
  }

  return `${headline}\n${dailyPath}`;
}

function formatErrorReply(error: unknown): string {
  const detail =
    error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "Unknown error";

  return `저장 실패\n${detail}`;
}

async function replyToTelegramMessage(
  config: AppConfig,
  message: TelegramMessage,
  text: string,
) {
  try {
    await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: message.chat.id,
      text,
      replyToMessageId: message.message_id,
    });
  } catch (error) {
    console.error("Failed to send Telegram status reply", error);
  }
}

function buildPhotoDailyText(caption: string | null, productUrl: string): string {
  const lines: string[] = [];

  if (caption) {
    const [firstLine, ...rest] = caption.split("\n");
    lines.push(`사진: ${firstLine}`);
    lines.push(...rest);
  } else {
    lines.push("사진");
  }

  lines.push(`[Google Photos에서 보기](${productUrl})`);
  return lines.join("\n");
}

function buildPhotoRawText(caption: string | null, productUrl: string): string {
  const parts = ["Google Photos", productUrl];

  if (caption) {
    parts.unshift("Caption", caption);
  }

  return parts.join("\n\n");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let config;

  try {
    config = getConfig();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const secret = readSecretHeader(req);
  if (secret !== config.telegramSecretToken) {
    return res.status(401).json({ ok: false, error: "Invalid webhook secret" });
  }

  let update: TelegramUpdate;

  try {
    update = parseUpdate(req.body);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ ok: false, error: "Invalid Telegram body" });
  }

  const message = getIncomingMessage(update);
  if (!message) {
    return res.status(200).json({ ok: true, ignored: "unsupported_update" });
  }

  if (!isAllowedChatId(config, message.chat.id)) {
    return res.status(200).json({ ok: true, ignored: "chat_not_allowed" });
  }

  const messageText = getMessageText(message);
  const photo = getLargestPhoto(message);

  if (!messageText && !photo) {
    await replyToTelegramMessage(config, message, "텍스트 메시지만 저장할 수 있습니다.");
    return res.status(200).json({ ok: true, ignored: "non_text_message" });
  }

  const timestamp = getTimestampParts(message.date, config.timezone);
  const paths = buildNotePaths({
    notesBaseDir: config.notesBaseDir,
    rawBaseDir: config.rawBaseDir,
    root: config.githubVaultRoot,
    dateKey: timestamp.dateKey,
    year: timestamp.year,
    updateId: update.update_id,
  });

  try {
    const senderLabel = getSenderLabel(message);
    let entryText = messageText || "";
    let rawText = messageText || "";
    let contentKind: "text" | "photo" = "text";
    let rawFrontmatter: Record<string, string | number | boolean | undefined> | undefined;

    if (photo) {
      if (!hasGooglePhotosConfig(config)) {
        await replyToTelegramMessage(
          config,
          message,
          "사진 저장이 아직 설정되지 않았습니다. Google Photos 설정이 필요합니다.",
        );
        return res.status(200).json({ ok: true, ignored: "photo_storage_not_configured" });
      }

      const uploadedPhoto = await uploadTelegramPhotoToGooglePhotos({
        config,
        photo,
        unixSeconds: message.date,
        description: messageText || undefined,
      });

      contentKind = "photo";
      entryText = buildPhotoDailyText(messageText, uploadedPhoto.productUrl);
      rawText = buildPhotoRawText(messageText, uploadedPhoto.productUrl);
      rawFrontmatter = {
        google_photos_media_item_id: uploadedPhoto.mediaItemId,
        google_photos_product_url: uploadedPhoto.productUrl,
        mime_type: uploadedPhoto.mimeType,
        telegram_file_id: uploadedPhoto.telegramFileId,
        telegram_file_unique_id: uploadedPhoto.telegramFileUniqueId,
        telegram_file_path: uploadedPhoto.filePath,
      };
    }

    const dailyResult = await updateTextFile(config, {
      path: paths.dailyPath,
      commitMessage: `chore(daily): append telegram entry for ${timestamp.dateKey}`,
      transform: (currentContent) =>
        appendDailyEntry({
          currentContent,
          dateKey: timestamp.dateKey,
          timeKey: timestamp.timeKey,
          updateId: update.update_id,
          messageText: entryText,
          senderLabel,
        }),
    });

    const rawContent = createRawNote({
      updateId: update.update_id,
      dateKey: timestamp.dateKey,
      receivedAtIso: timestamp.receivedAtIso,
      messageId: message.message_id,
      chatId: String(message.chat.id),
      senderLabel,
      messageText: rawText,
      contentType: contentKind,
      extraFrontmatter: rawFrontmatter,
    });

    const rawResult = await createTextFileIfMissing(config, {
      path: paths.rawPath,
      commitMessage: `chore(raw): store telegram payload ${update.update_id}`,
      content: rawContent,
    });

    await replyToTelegramMessage(
      config,
      message,
      formatSuccessReply({
        dailyPath: paths.dailyPath,
        dailyResult,
        contentKind,
      }),
    );

    return res.status(200).json({
      ok: true,
      dailyPath: paths.dailyPath,
      rawPath: paths.rawPath,
      dailyResult,
      rawResult,
    });
  } catch (error) {
    console.error(error);
    await replyToTelegramMessage(config, message, formatErrorReply(error));
    return res.status(500).json({ ok: false, error: "Failed to write to GitHub" });
  }
}
