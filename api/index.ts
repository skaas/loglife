import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    service: "telegram-obsidian-vault-bot",
    health: "/api/health",
    webhook: "/api/telegram/webhook",
  });
}
