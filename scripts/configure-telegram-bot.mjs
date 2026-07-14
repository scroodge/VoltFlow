import { existsSync, readFileSync } from "node:fs";

loadEnvFile(".env");
loadEnvFile(".env.local");

const args = new Set(process.argv.slice(2));
const configureWebhook = args.has("--webhook");
const token = process.env.TELEGRAM_BOT_TOKEN;
// Mirrors DEFAULT_SITE_URL in src/lib/site-url.ts (a .mjs script cannot import the TS module).
const DEFAULT_SITE_URL = "https://voltflow.life";
const DEFAULT_TELEGRAM_EDGE_URL = "https://bot.voltflow.life";
const webAppUrl =
  process.env.TELEGRAM_WEB_APP_URL ??
  withPath(process.env.NEXT_PUBLIC_SITE_URL, "/telegram") ??
  `${DEFAULT_SITE_URL}/telegram`;
const webhookUrl =
  process.env.TELEGRAM_WEBHOOK_URL ??
  withPath(process.env.TELEGRAM_EDGE_URL, "/api/telegram/webhook") ??
  `${DEFAULT_TELEGRAM_EDGE_URL}/api/telegram/webhook`;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

await callTelegram("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: "VoltFlow",
    web_app: { url: webAppUrl },
  },
});

await callTelegram("setMyCommands", {
  commands: [
    { command: "start", description: "Open VoltFlow" },
    { command: "app", description: "Open app" },
  ],
});

if (configureWebhook) {
  const body = {
    url: webhookUrl,
      allowed_updates: ["message", "edited_message"],
    drop_pending_updates: false,
  };
  if (webhookSecret) body.secret_token = webhookSecret;
  await callTelegram("setWebhook", body);
}

const me = await callTelegram("getMe", {});
console.log(
  JSON.stringify(
    {
      ok: true,
      bot: me.result?.username,
      menuButtonUrl: webAppUrl,
      webhookConfigured: configureWebhook,
      webhookUrl: configureWebhook ? webhookUrl : null,
      webhookSecret: configureWebhook ? Boolean(webhookSecret) : null,
    },
    null,
    2,
  ),
);

async function callTelegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`${method} failed: ${payload?.description ?? response.status}`);
  }
  return payload;
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function withPath(base, path) {
  if (!base) return null;
  return `${base.replace(/\/$/, "")}${path}`;
}
