/**
 * Integration script: run the real TelegramActionNode with the exact same
 * payload the workflow uses (buy_notify → telegram_action). No mocks — real
 * Telegram API. Use to verify the bot can send to your chat/group.
 *
 * Run from obelisk-core root:
 *   npx tsx ts/scripts/telegram-action-real-send.ts
 *
 * Requires in obelisk-core/.env: TELEGRAM_DEV_BOT_TOKEN (or TELEGRAM_DEV_AGENT_BOT_TOKEN
 * or TELEGRAM_BOT_TOKEN), and TELEGRAM_CHAT_ID.
 */
import path from "path";
import dotenv from "dotenv";

const root = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(root, ".env"), override: true });

import type { ExecutionContext } from "../src/core/execution/nodeBase";
import { TelegramActionNode } from "../src/core/execution/nodes/telegramAction";

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!CHAT_ID) {
  console.error("TELEGRAM_CHAT_ID is required. Set it in obelisk-core/.env");
  process.exit(1);
}

// Exact shape buy_notify produces (send_message + chat_id)
const buyNotifyPayload = {
  actions: [
    {
      action: "send_message",
      params: {
        text: "[real-send test] Bought 0x05f3...9b90 for 0.001 ETH. Tx: https://basescan.org/tx/0x6b36564d3bb20565942efcd72d15fc6d66a5bba0d254864ab4d40bef78a99974",
      },
    },
  ],
  chat_id: CHAT_ID,
};

function main() {
  const token =
    process.env.TELEGRAM_DEV_BOT_TOKEN ||
    process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("Missing TELEGRAM_DEV_BOT_TOKEN (or TELEGRAM_DEV_AGENT_BOT_TOKEN / TELEGRAM_BOT_TOKEN) in .env");
    process.exit(1);
  }
  if (!CHAT_ID) {
    console.error("Missing TELEGRAM_CHAT_ID in .env");
    process.exit(1);
  }

  const node = new TelegramActionNode("13", {
    id: "13",
    type: "telegram_action",
    inputs: {},
    position: { x: 0, y: 0 },
  });

  node.inputConnections["actions"] = [{ nodeId: "12", outputName: "actions" }];
  node.inputConnections["chat_id"] = [{ nodeId: "12", outputName: "chat_id" }];

  const context: ExecutionContext = {
    variables: {},
    nodeOutputs: {
      "12": buyNotifyPayload,
    },
  };

  (async () => {
    console.log("Calling TelegramActionNode.execute() with real fetch (no mocks)...");
    console.log("chat_id:", CHAT_ID);
    console.log("payload:", JSON.stringify(buyNotifyPayload, null, 2));
    const result = await node.execute(context);
    console.log("Result:", result);
    if (result.success) {
      console.log("OK – message sent via TelegramAction node.");
    } else {
      console.error("FAIL –", (result as { debug_text?: string }).debug_text);
      process.exit(1);
    }
  })();
}

main();
