import type { AppConfig } from "./config.js";
import {
  downloadTelegramFile,
  getTelegramFile,
  type TelegramPhotoSize,
} from "./telegram.js";

function sanitizeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function extensionFromPath(filePath: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filePath);
  return match ? `.${match[1].toLowerCase()}` : ".jpg";
}

function filenameFromPhoto(photo: TelegramPhotoSize, filePath: string, unixSeconds: number): string {
  const timestamp = new Date(unixSeconds * 1000).toISOString().replace(/[:.]/g, "-");
  const stem = sanitizeFileStem(photo.file_unique_id || photo.file_id);
  return `telegram-${timestamp}-${stem}${extensionFromPath(filePath)}`;
}

function fallbackDriveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

async function getGoogleAccessToken(config: AppConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.googleDriveClientId,
    client_secret: config.googleDriveClientSecret,
    refresh_token: config.googleDriveRefreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(`Google OAuth token refresh failed: ${JSON.stringify(payload)}`);
  }

  return payload.access_token;
}

async function uploadBytesToGoogleDrive({
  accessToken,
  bytes,
  contentType,
  fileName,
  folderId,
}: {
  accessToken: string;
  bytes: ArrayBuffer;
  contentType: string;
  fileName: string;
  folderId: string;
}): Promise<{
  id: string;
  mimeType?: string;
  name?: string;
  webContentLink?: string;
  webViewLink?: string;
}> {
  const boundary = `loglife-${Date.now().toString(16)}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,mimeType,name,webContentLink,webViewLink&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  const payload = (await response.json()) as {
    id?: string;
    mimeType?: string;
    name?: string;
    webContentLink?: string;
    webViewLink?: string;
    error?: { message?: string };
  };

  if (!response.ok || !payload.id) {
    throw new Error(
      `Google Drive upload failed: ${payload.error?.message || JSON.stringify(payload)}`,
    );
  }

  return {
    id: payload.id,
    mimeType: payload.mimeType,
    name: payload.name,
    webContentLink: payload.webContentLink,
    webViewLink: payload.webViewLink,
  };
}

async function enablePublicReadAccess(accessToken: string, fileId: string): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "anyone",
        role: "reader",
        allowFileDiscovery: false,
      }),
    },
  );

  if (response.ok) {
    return;
  }

  const payload = (await response.json()) as {
    error?: { message?: string };
  };
  throw new Error(
    `Google Drive permission update failed: ${payload.error?.message || response.statusText}`,
  );
}

export async function uploadTelegramPhotoToGoogleDrive({
  config,
  photo,
  unixSeconds,
}: {
  config: AppConfig;
  photo: TelegramPhotoSize;
  unixSeconds: number;
}) {
  const accessToken = await getGoogleAccessToken(config);
  const telegramFile = await getTelegramFile(config.telegramBotToken, photo.file_id);

  if (!telegramFile.file_path) {
    throw new Error("Telegram photo file_path is missing");
  }

  const downloaded = await downloadTelegramFile(config.telegramBotToken, telegramFile.file_path);
  const fileName = filenameFromPhoto(photo, downloaded.filePath, unixSeconds);
  const driveFile = await uploadBytesToGoogleDrive({
    accessToken,
    bytes: downloaded.bytes,
    contentType: downloaded.contentType,
    fileName,
    folderId: config.googleDriveFolderId,
  });

  if (config.googleDrivePublicLinks) {
    await enablePublicReadAccess(accessToken, driveFile.id);
  }

  return {
    fileId: driveFile.id,
    fileName: driveFile.name || fileName,
    filePath: downloaded.filePath,
    mimeType: driveFile.mimeType || downloaded.contentType,
    productUrl: driveFile.webViewLink || driveFile.webContentLink || fallbackDriveViewUrl(driveFile.id),
    publicLinkEnabled: config.googleDrivePublicLinks,
    telegramFileId: photo.file_id,
    telegramFileUniqueId: photo.file_unique_id,
    webContentLink: driveFile.webContentLink || "",
    webViewLink: driveFile.webViewLink || fallbackDriveViewUrl(driveFile.id),
  };
}
