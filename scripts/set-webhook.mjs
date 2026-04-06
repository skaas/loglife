const token = process.env.TELEGRAM_BOT_TOKEN;
const secretToken = process.env.TELEGRAM_SECRET_TOKEN;
const baseUrl = process.argv[2] || process.env.WEBHOOK_BASE_URL;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

if (!secretToken) {
  throw new Error("TELEGRAM_SECRET_TOKEN is required");
}

if (!baseUrl) {
  throw new Error("Pass WEBHOOK_BASE_URL or the deployed URL as the first argument");
}

const webhookUrl = new URL("/api/telegram/webhook", baseUrl).toString();
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secretToken,
    drop_pending_updates: false,
  }),
});

const payload = await response.json();

if (!response.ok || !payload.ok) {
  throw new Error(`Telegram setWebhook failed: ${JSON.stringify(payload)}`);
}

console.log(`Webhook registered: ${webhookUrl}`);
