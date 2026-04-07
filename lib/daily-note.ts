function joinPath(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function getDatePart(date: Date, timezone: string, part: "year" | "month" | "day"): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      [part]: "2-digit",
    }).formatToParts(date).find((item) => item.type === part)?.value ?? ""
  );
}

function getYearPart(date: Date, timezone: string): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
    }).formatToParts(date).find((item) => item.type === "year")?.value ?? ""
  );
}

function getTimeParts(date: Date, timezone: string): { hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return {
    hour: parts.find((item) => item.type === "hour")?.value ?? "00",
    minute: parts.find((item) => item.type === "minute")?.value ?? "00",
  };
}

function createDailyShell(dateKey: string): string {
  return `---
date: ${dateKey}
tags:
  - daily
  - telegram
---

# ${dateKey}
`;
}

function normalizeMarkdownText(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}

export function getTimestampParts(unixSeconds: number, timezone: string) {
  const date = new Date(unixSeconds * 1000);
  const year = getYearPart(date, timezone);
  const month = getDatePart(date, timezone, "month");
  const day = getDatePart(date, timezone, "day");
  const { hour, minute } = getTimeParts(date, timezone);

  return {
    year,
    dateKey: `${year}-${month}-${day}`,
    timeKey: `${hour}:${minute}`,
    receivedAtIso: date.toISOString(),
  };
}

export function buildNotePaths({
  notesBaseDir,
  rawBaseDir,
  root,
  dateKey,
  year,
  updateId,
}: {
  notesBaseDir: string;
  rawBaseDir: string;
  root: string;
  dateKey: string;
  year: string;
  updateId: number;
}) {
  return {
    dailyPath: joinPath(root, notesBaseDir, year, `${dateKey}.md`),
    rawPath: joinPath(root, rawBaseDir, dateKey, `${updateId}.md`),
  };
}

export function appendDailyEntry({
  currentContent,
  dateKey,
  timeKey,
  updateId,
  messageText,
  senderLabel,
}: {
  currentContent: string | null;
  dateKey: string;
  timeKey: string;
  updateId: number;
  messageText: string;
  senderLabel: string;
}): string {
  const marker = `<!-- tg:update_id:${updateId} -->`;
  const existingContent = currentContent ?? createDailyShell(dateKey);

  if (existingContent.includes(marker)) {
    return existingContent;
  }

  const normalized = normalizeMarkdownText(messageText);
  const lines = normalized.split("\n");
  const prefix = senderLabel ? `- ${timeKey} [${senderLabel}] ` : `- ${timeKey} `;
  const firstLine = `${prefix}${lines[0]} ${marker}`.trimEnd();
  const continuation = lines.slice(1).map((line) => `  ${line}`);
  const entry = [firstLine, ...continuation].join("\n");

  return `${existingContent.trimEnd()}\n\n${entry}\n`;
}

export function createRawNote({
  updateId,
  dateKey,
  receivedAtIso,
  messageId,
  chatId,
  senderLabel,
  messageText,
  contentType,
  extraFrontmatter,
}: {
  updateId: number;
  dateKey: string;
  receivedAtIso: string;
  messageId: number;
  chatId: string;
  senderLabel: string;
  messageText: string;
  contentType?: string;
  extraFrontmatter?: Record<string, string | number | boolean | undefined>;
}) {
  const normalized = normalizeMarkdownText(messageText);
  const extraLines = Object.entries(extraFrontmatter ?? {})
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => {
      if (typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value)}`;
      }

      return `${key}: ${JSON.stringify(value)}`;
    });

  return `---
source: telegram
content_type: ${JSON.stringify(contentType || "text")}
date: ${dateKey}
update_id: ${updateId}
message_id: ${messageId}
chat_id: "${chatId}"
sender: "${senderLabel}"
received_at: ${receivedAtIso}
${extraLines.join("\n")}${extraLines.length ? "\n" : ""}---

# Telegram Raw ${updateId}

~~~text
${normalized}
~~~
`;
}
