# Telegram -> Obsidian Vault Bot

텔레그램으로 보낸 메시지를 날짜별 Markdown 파일로 정리해서 GitHub 저장소에 저장하는 Vercel 프로젝트입니다. Obsidian에서는 해당 GitHub 저장소를 vault로 열거나 `Obsidian Git` 플러그인으로 동기화하면 됩니다.

## 동작 방식

1. 텔레그램 봇이 `/api/telegram/webhook` 으로 메시지를 보냅니다.
2. Vercel 함수가 메시지를 받아 날짜와 시간을 `Asia/Seoul` 기준으로 계산합니다.
3. 텍스트는 그대로 저장하고, 사진은 Google Photos에 업로드한 뒤 링크를 저장합니다.
4. `Daily/YYYY/YYYY-MM-DD.md` 파일에 메시지를 append 합니다.
5. 원문은 `Inbox/Telegram/YYYY-MM-DD/<update_id>.md` 에 저장합니다.
6. 저장이 끝나면 봇이 원문 메시지에 완료 또는 오류 상태를 reply 합니다.
7. 모든 노트는 GitHub 저장소에 커밋됩니다.

## 폴더 구조

```text
api/
  health.ts
  telegram/webhook.ts
lib/
  config.ts
  daily-note.ts
  google-photos.ts
  github.ts
  telegram.ts
prompts/
  daily-rollup.md
  entry-format.md
scripts/
  set-webhook.mjs
```

`prompts/` 는 나중에 LLM 정리 단계를 넣을 때 버전 관리용으로 바로 확장할 수 있게 잡아둔 폴더입니다.

## 환경변수

`.env.example` 를 기준으로 설정하면 됩니다.

- `GITHUB_TOKEN`: vault 저장소에 `Contents: Read and write` 권한이 있는 토큰
- `GITHUB_OWNER`: vault 저장소 owner
- `GITHUB_REPO`: vault 저장소 이름
- `GITHUB_BRANCH`: 기본 브랜치. 보통 `main`
- `GITHUB_VAULT_ROOT`: 저장소 하위 폴더에만 저장하고 싶을 때 사용
- `TELEGRAM_BOT_TOKEN`: BotFather에서 받은 봇 토큰
- `TELEGRAM_SECRET_TOKEN`: Telegram webhook secret
- `ALLOWED_CHAT_IDS`: 허용할 chat id 목록. 쉼표 구분. 비워두면 모두 허용
- `GOOGLE_PHOTOS_CLIENT_ID`: Google OAuth client id
- `GOOGLE_PHOTOS_CLIENT_SECRET`: Google OAuth client secret
- `GOOGLE_PHOTOS_REFRESH_TOKEN`: Google OAuth refresh token
- `GOOGLE_PHOTOS_ALBUM_ID`: 선택. 앱이 만든 Google Photos 앨범에 넣고 싶을 때만 사용
- `TIMEZONE`: 날짜 계산용 타임존. 기본 `Asia/Seoul`
- `NOTES_BASE_DIR`: 일별 노트 경로. 기본 `Daily`
- `RAW_BASE_DIR`: 원문 저장 경로. 기본 `Inbox/Telegram`
- `WEBHOOK_BASE_URL`: `set:webhook` 스크립트용 배포 URL

## 로컬 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

Vercel 개발 서버가 뜨면 `/api/health` 로 확인할 수 있습니다.

## 배포 순서

1. 이 폴더를 GitHub 저장소로 올립니다.
2. Vercel에서 해당 저장소를 Import 합니다.
3. Vercel Project Settings에서 환경변수를 등록합니다.
4. 첫 배포가 끝나면 webhook URL을 등록합니다.

```bash
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_SECRET_TOKEN=... \
WEBHOOK_BASE_URL=https://your-project.vercel.app \
npm run set:webhook
```

## 메모

- Vercel에는 이 폴더를 그대로 배포하면 됩니다.
- 텍스트 메시지는 그대로 저장합니다.
- 사진 메시지는 Google Photos에 업로드하고 `productUrl` 링크만 노트에 남깁니다.
- 사진 업로드에는 Google Photos Library API OAuth가 필요합니다. 서비스 계정은 지원되지 않습니다.
- Google Photos는 `baseUrl` 이 아니라 `productUrl` 을 노트에 저장해야 장기 링크로 쓸 수 있습니다.
- 저장 성공 시 `저장 완료`, 실패 시 `저장 실패` 를 텔레그램 답장으로 보냅니다.
- 같은 Telegram `update_id` 는 HTML 주석 마커로 중복 append를 막습니다.
- 먼저 `ALLOWED_CHAT_IDS` 를 비워두고 한 번 메시지를 보내서 동작을 확인한 뒤 제한을 거는 방식이 가장 단순합니다.

## Google Photos 설정

1. Google Cloud에서 Google Photos API를 활성화합니다.
2. OAuth client를 만들고 redirect 기반으로 한 번 사용자 동의를 받습니다.
3. 최소 `photoslibrary.appendonly` scope로 refresh token을 발급받습니다.
4. 아래 값을 Vercel 환경변수에 넣습니다.

```text
GOOGLE_PHOTOS_CLIENT_ID
GOOGLE_PHOTOS_CLIENT_SECRET
GOOGLE_PHOTOS_REFRESH_TOKEN
GOOGLE_PHOTOS_ALBUM_ID   # optional
```

설정 후 사진 메시지를 보내면:

```md
- 10:42 사진: 아침 커피
  [Google Photos에서 보기](https://photos.google.com/...)
```
