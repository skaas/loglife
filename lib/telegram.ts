export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  from?: {
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export function getIncomingMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? null;
}

export function getMessageText(message: TelegramMessage): string | null {
  const text = (message.text ?? message.caption ?? "").trim();
  return text || null;
}

export function getSenderLabel(message: TelegramMessage): string {
  if (message.from?.username) {
    return `@${message.from.username}`;
  }

  const fullName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || "unknown";
}

export function getLargestPhoto(message: TelegramMessage): TelegramPhotoSize | null {
  const photos = message.photo ?? [];

  if (photos.length === 0) {
    return null;
  }

  return photos.reduce((largest, current) => {
    const largestArea = largest.width * largest.height;
    const currentArea = current.width * current.height;

    if (currentArea > largestArea) {
      return current;
    }

    if (currentArea === largestArea && (current.file_size ?? 0) > (largest.file_size ?? 0)) {
      return current;
    }

    return largest;
  });
}

export async function getTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{
  file_id: string;
  file_path?: string;
  file_size?: number;
}> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_id: fileId,
    }),
  });

  const payload = (await response.json()) as TelegramApiResponse<{
    file_id: string;
    file_path?: string;
    file_size?: number;
  }>;

  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(`Telegram getFile failed: ${JSON.stringify(payload)}`);
  }

  return payload.result;
}

export async function downloadTelegramFile(
  botToken: string,
  filePath: string,
): Promise<{
  bytes: ArrayBuffer;
  contentType: string;
  filePath: string;
}> {
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${await response.text()}`);
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") || "application/octet-stream",
    filePath,
  };
}

export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  replyToMessageId,
}: {
  botToken: string;
  chatId: number | string;
  text: string;
  replyToMessageId?: number;
}) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true,
    }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(`Telegram sendMessage failed: ${JSON.stringify(payload)}`);
  }
}
