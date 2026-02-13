#!/usr/bin/env node
/**
 * Isolated test for Telegram send_message – same request as TelegramActionNode.
 * Use this to verify bot token and chat_id without running the full workflow.
 *
 * Usage (from obelisk-core):
 *   node scripts/send-telegram-test.js
 *   node scripts/send-telegram-test.js --chat_id=-1002523187907
 *
 * If the workflow gets 404 but this script succeeds, the runner process
 * likely doesn’t have the same .env (e.g. TELEGRAM_BOT_TOKEN).
 *
 * Token: TELEGRAM_BOT_TOKEN or TELEGRAM_DEV_AGENT_BOT_TOKEN in .env
 * Chat:  TELEGRAM_CHAT_ID in .env, or --chat_id=XXX
 */

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (!fs.existsSync(envPath)) {
  console.error("Missing .env at", envPath);
  process.exit(1);
}

const env = Object.create(null);
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

// Same resolution as workflow (config.ts + telegramAction node)
const token =
  env.TELEGRAM_BOT_TOKEN ||
  env.TELEGRAM_DEV_AGENT_BOT_TOKEN ||
  env.TELEGRAM_DEV_BOT_TOKEN;

const chatIdArg = process.argv.find((a) => a.startsWith("--chat_id="));
const chatId = chatIdArg
  ? chatIdArg.replace(/^--chat_id=/, "").trim()
  : (env.TELEGRAM_CHAT_ID || "").trim();

if (!token) {
  console.error("No Telegram bot token in .env (TELEGRAM_BOT_TOKEN / TELEGRAM_DEV_AGENT_BOT_TOKEN / TELEGRAM_DEV_BOT_TOKEN)");
  process.exit(1);
}
if (!chatId) {
  console.error("No chat_id. Set TELEGRAM_CHAT_ID in .env or run: node scripts/send-telegram-test.js --chat_id=YOUR_CHAT_ID");
  process.exit(1);
}

const API_BASE = "https://api.telegram.org/bot";

async function post(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

(async () => {
  const mask = (s) => (s ? s.slice(0, 8) + "…" + (s.length > 16 ? s.slice(-4) : "") : "");
  console.log("Token:", mask(token));
  console.log("Chat ID:", chatId);
  console.log("");

  // 1) getMe – if this 404s, the token is wrong
  const getMeUrl = `${API_BASE}${token}/getMe`;
  const getMe = await post(getMeUrl, {});
  if (getMe.status !== 200 || !getMe.data.ok) {
    console.error("Bot token invalid or Telegram unreachable.");
    console.error("GET getMe → HTTP", getMe.status, JSON.stringify(getMe.data, null, 2));
    if (getMe.status === 404) {
      console.error("404 on getMe = token is wrong or revoked. Create a new bot with @BotFather and set TELEGRAM_BOT_TOKEN in .env");
    }
    process.exit(1);
  }
  console.log("Bot:", getMe.data.result?.username ? "@" + getMe.data.result.username : getMe.data.result);

  // 2) sendMessage – exact same call as TelegramActionNode send_message
  const sendUrl = `${API_BASE}${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: "Test from obelisk-core (send-telegram-test.js). If you see this, bot + chat_id are OK.",
    parse_mode: "HTML",
  };
  const send = await post(sendUrl, payload);

  if (send.data.ok) {
    console.log("Sent message to chat", chatId);
    process.exit(0);
  }

  console.error("sendMessage failed.");
  console.error("HTTP", send.status, JSON.stringify(send.data, null, 2));
  if (send.data.error_code === 400) {
    console.error("400 = Bad request (e.g. invalid parse_mode or text). Try without parse_mode in the node.");
  }
  if (send.data.error_code === 401) {
    console.error("401 = Unauthorized. Token is wrong.");
  }
  if (send.data.error_code === 403) {
    console.error("403 = Bot was blocked by user or cannot write to this chat.");
  }
  if (send.data.error_code === 404) {
    console.error("404 = Chat not found. Bot must be added to the group/channel, or chat_id is wrong. For groups, chat_id is a negative number (e.g. -1002523187907).");
  }
  process.exit(1);
})();
