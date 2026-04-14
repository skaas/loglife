export type AppConfig = {
  githubBranch: string;
  githubOwner: string;
  githubRepo: string;
  githubToken: string;
  githubVaultRoot: string;
  googleDriveClientId: string;
  googleDriveClientSecret: string;
  googleDriveRefreshToken: string;
  googleDriveFolderId: string;
  googleDrivePublicLinks: boolean;
  notesBaseDir: string;
  rawBaseDir: string;
  telegramBotToken: string;
  telegramSecretToken: string;
  timezone: string;
  allowedChatIds: Set<string>;
};

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function optionalBoolean(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function normalizePathPart(value: string): string {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function parseAllowedChatIds(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function getConfig(): AppConfig {
  return {
    githubBranch: optional("GITHUB_BRANCH", "main"),
    githubOwner: required("GITHUB_OWNER"),
    githubRepo: required("GITHUB_REPO"),
    githubToken: required("GITHUB_TOKEN"),
    githubVaultRoot: normalizePathPart(optional("GITHUB_VAULT_ROOT")),
    googleDriveClientId: optional("GOOGLE_DRIVE_CLIENT_ID"),
    googleDriveClientSecret: optional("GOOGLE_DRIVE_CLIENT_SECRET"),
    googleDriveRefreshToken: optional("GOOGLE_DRIVE_REFRESH_TOKEN"),
    googleDriveFolderId: optional("GOOGLE_DRIVE_FOLDER_ID"),
    googleDrivePublicLinks: optionalBoolean("GOOGLE_DRIVE_PUBLIC_LINKS"),
    notesBaseDir: normalizePathPart(optional("NOTES_BASE_DIR", "Daily")),
    rawBaseDir: normalizePathPart(optional("RAW_BASE_DIR", "Inbox/Telegram")),
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramSecretToken: required("TELEGRAM_SECRET_TOKEN"),
    timezone: optional("TIMEZONE", "Asia/Seoul"),
    allowedChatIds: parseAllowedChatIds(optional("ALLOWED_CHAT_IDS")),
  };
}

export function isAllowedChatId(config: AppConfig, chatId: number | string): boolean {
  if (config.allowedChatIds.size === 0) {
    return true;
  }

  return config.allowedChatIds.has(String(chatId));
}

export function hasGoogleDriveConfig(config: AppConfig): boolean {
  return Boolean(
    config.googleDriveClientId &&
      config.googleDriveClientSecret &&
      config.googleDriveRefreshToken &&
      config.googleDriveFolderId,
  );
}
