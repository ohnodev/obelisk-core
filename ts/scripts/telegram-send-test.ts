/**
 * Minimal test: send one message to Telegram with bot token + chat_id.
 * Use this to verify the bot can send to a given chat (no workflow, no nodes).
 *
 * Run from obelisk-core root:
 *   npx tsx ts/scripts/telegram-send-test.ts
 *   TELEGRAM_CHAT_ID=-1003669072955 npx tsx ts/scripts/telegram-send-test.ts
 *
 * Requires in .env: TELEGRAM_DEV_AGENT_BOT_TOKEN or TELEGRAM_BOT_TOKEN, and TELEGRAM_CHAT_ID.
 */
import path from "path";
import dotenv from "dotenv";

const root = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(root, ".env") });

const API_BASE = "https://api.telegram.org/bot";

async function main() {
  const token =
    process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_DEV_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    console.error("Missing TELEGRAM_DEV_AGENT_BOT_TOKEN or TELEGRAM_BOT_TOKEN in .env");
    process.exit(1);
  }
  if (!chatId) {
    console.error("Missing TELEGRAM_CHAT_ID in .env");
    process.exit(1);
  }

  const url = `${API_BASE}${token}/sendMessage`;
  const payload = {
    chat_id: chatId.trim(),
    text: "[obelisk-core] Telegram send test – if you see this, bot + chat are OK.",
    parse_mode: "HTML",
  };

  console.log("POST", url.replace(token, token.slice(-6) + "..."));
  console.log("chat_id:", chatId);
  console.log("payload:", JSON.stringify(payload, null, 2));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));

  console.log("HTTP", res.status);
  console.log("Response:", JSON.stringify(data, null, 2));

  if (data?.ok === true) {
    console.log("OK – message sent.");
    return;
  }

  const err = data?.description ?? data?.error_code ?? res.statusText;
  console.error("FAIL –", err);
  if (data?.error_code === 404) {
    console.error("\n404 = chat not found or bot not in that chat. Check:");
    console.error("  1. chat_id is correct (e.g. add bot to group, get group id).");
    console.error("  2. Your workflow uses the same chat_id as TELEGRAM_CHAT_ID, or the bot is in that chat.");
  }
  process.exit(1);
}

main();
