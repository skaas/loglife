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

async function getGoogleAccessToken(config: AppConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.googlePhotosClientId,
    client_secret: config.googlePhotosClientSecret,
    refresh_token: config.googlePhotosRefreshToken,
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

async function uploadBytesToGooglePhotos({
  accessToken,
  bytes,
  contentType,
  fileName,
}: {
  accessToken: string;
  bytes: ArrayBuffer;
  contentType: string;
  fileName: string;
}): Promise<string> {
  const response = await fetch("https://photoslibrary.googleapis.com/v1/uploads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "X-Goog-Upload-Content-Type": contentType,
      "X-Goog-Upload-File-Name": fileName,
      "X-Goog-Upload-Protocol": "raw",
    },
    body: bytes,
  });

  const uploadToken = await response.text();

  if (!response.ok || !uploadToken) {
    throw new Error(`Google Photos upload failed: ${response.status} ${uploadToken}`);
  }

  return uploadToken;
}

async function createMediaItem({
  accessToken,
  uploadToken,
  fileName,
  description,
  albumId,
}: {
  accessToken: string;
  uploadToken: string;
  fileName: string;
  description?: string;
  albumId?: string;
}): Promise<{
  id: string;
  productUrl: string;
  mimeType?: string;
  filename?: string;
}> {
  const response = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(albumId ? { albumId } : {}),
      newMediaItems: [
        {
          ...(description ? { description } : {}),
          simpleMediaItem: {
            fileName,
            uploadToken,
          },
        },
      ],
    }),
  });

  const payload = (await response.json()) as {
    newMediaItemResults?: Array<{
      status?: { message?: string };
      mediaItem?: {
        id?: string;
        productUrl?: string;
        mimeType?: string;
        filename?: string;
      };
    }>;
  };

  const result = payload.newMediaItemResults?.[0];
  const mediaItem = result?.mediaItem;

  if (!response.ok || !mediaItem?.id || !mediaItem.productUrl) {
    const message = result?.status?.message || JSON.stringify(payload);
    throw new Error(`Google Photos batchCreate failed: ${message}`);
  }

  return {
    id: mediaItem.id,
    productUrl: mediaItem.productUrl,
    mimeType: mediaItem.mimeType,
    filename: mediaItem.filename,
  };
}

export async function uploadTelegramPhotoToGooglePhotos({
  config,
  photo,
  unixSeconds,
  description,
}: {
  config: AppConfig;
  photo: TelegramPhotoSize;
  unixSeconds: number;
  description?: string;
}) {
  const accessToken = await getGoogleAccessToken(config);
  const telegramFile = await getTelegramFile(config.telegramBotToken, photo.file_id);

  if (!telegramFile.file_path) {
    throw new Error("Telegram photo file_path is missing");
  }

  const downloaded = await downloadTelegramFile(config.telegramBotToken, telegramFile.file_path);
  const fileName = filenameFromPhoto(photo, downloaded.filePath, unixSeconds);
  const uploadToken = await uploadBytesToGooglePhotos({
    accessToken,
    bytes: downloaded.bytes,
    contentType: downloaded.contentType,
    fileName,
  });
  const mediaItem = await createMediaItem({
    accessToken,
    uploadToken,
    fileName,
    description,
    albumId: config.googlePhotosAlbumId || undefined,
  });

  return {
    fileName,
    filePath: downloaded.filePath,
    mediaItemId: mediaItem.id,
    mimeType: mediaItem.mimeType || downloaded.contentType,
    productUrl: mediaItem.productUrl,
    telegramFileId: photo.file_id,
    telegramFileUniqueId: photo.file_unique_id,
  };
}
