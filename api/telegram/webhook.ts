import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getConfig, isAllowedChatId } from "../../lib/config.js";
import {
  appendDailyEntry,
  buildNotePaths,
  createRawNote,
  getTimestampParts,
} from "../../lib/daily-note.js";
import { createTextFileIfMissing, updateTextFile } from "../../lib/github.js";
import {
  getIncomingMessage,
  getMessageText,
  getSenderLabel,
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
  if (!messageText) {
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

    const dailyResult = await updateTextFile(config, {
      path: paths.dailyPath,
      commitMessage: `chore(daily): append telegram entry for ${timestamp.dateKey}`,
      transform: (currentContent) =>
        appendDailyEntry({
          currentContent,
          dateKey: timestamp.dateKey,
          timeKey: timestamp.timeKey,
          updateId: update.update_id,
          messageText,
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
      messageText,
    });

    const rawResult = await createTextFileIfMissing(config, {
      path: paths.rawPath,
      commitMessage: `chore(raw): store telegram payload ${update.update_id}`,
      content: rawContent,
    });

    return res.status(200).json({
      ok: true,
      dailyPath: paths.dailyPath,
      rawPath: paths.rawPath,
      dailyResult,
      rawResult,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: "Failed to write to GitHub" });
  }
}
