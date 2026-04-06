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
