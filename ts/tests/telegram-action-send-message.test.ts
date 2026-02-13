/**
 * Unit test: when there is NO reply_to_message_id (e.g. scheduler → buy_notify → telegram_action),
 * we must send a plain message only — no reply_parameters / reply_to_message_id.
 *
 * Mimics the real flow from logs: buy_notify outputs send_message + chat_id,
 * telegram_action receives them and must call sendMessage with chat_id + text only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExecutionContext } from "../src/core/execution/nodeBase";
import { TelegramActionNode } from "../src/core/execution/nodes/telegramAction";

const API_BASE = "https://api.telegram.org/bot";

describe("TelegramActionNode send_message (no reply)", () => {
  const fakeToken = "test-bot-token-123";
  const chatId = "-1002523187907";
  const messageText =
    "Bought 0x05f3...9b90 for 0.001 ETH. Tx: https://basescan.org/tx/0x6b36564d3bb20565942efcd72d15fc6d66a5bba0d254864ab4d40bef78a99974";

  let fetchMock: ReturnType<typeof vi.fn>;
  let sendMessageCalls: { url: string; body: Record<string, unknown> }[];

  beforeEach(() => {
    sendMessageCalls = [];
    fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "TestBot" } }));
      }
      if (urlStr.includes("/sendMessage")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        sendMessageCalls.push({ url: urlStr, body });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.TELEGRAM_BOT_TOKEN = fakeToken;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("sends plain message only (no reply_parameters) when actions=send_message and no reply_to_message_id", async () => {
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
        "12": {
          actions: [
            {
              action: "send_message",
              params: { text: messageText },
            },
          ],
          chat_id: chatId,
        },
      },
    };

    const result = await node.execute(context);

    expect(result.success).toBe(true);
    expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1);

    const sendMessageCall = sendMessageCalls.find((c) => c.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    expect(sendMessageCall!.body).toMatchObject({
      chat_id: chatId,
      text: messageText,
      parse_mode: "HTML",
    });
    expect(sendMessageCall!.body).not.toHaveProperty("reply_parameters");
    expect(sendMessageCall!.body).not.toHaveProperty("reply_to_message_id");
  });

  /**
   * Exact payload from obelisk-core.log (Node 12 buy_notify → Node 13 telegram_action).
   * Copy-paste from log to verify tg action is invoked with this call and works.
   */
  it("invokes telegram_action with exact buy_notify output from log (send_message, chat_id only)", async () => {
    const node = new TelegramActionNode("13", {
      id: "13",
      type: "telegram_action",
      inputs: {},
      position: { x: 0, y: 0 },
    });

    node.inputConnections["actions"] = [{ nodeId: "12", outputName: "actions" }];
    node.inputConnections["chat_id"] = [{ nodeId: "12", outputName: "chat_id" }];

    // Literally from log: Node 12 (buy_notify) → actions + chat_id
    const node12Output = {
      actions: [
        {
          action: "send_message",
          params: {
            text:
              "Bought 0x05f3...9b90 for 0.001 ETH. Tx: https://basescan.org/tx/0x6b36564d3bb20565942efcd72d15fc6d66a5bba0d254864ab4d40bef78a99974",
          },
        },
      ],
      chat_id: "-1002523187907",
    };

    const context: ExecutionContext = {
      variables: {},
      nodeOutputs: { "12": node12Output },
    };

    const result = await node.execute(context);

    expect(result.success).toBe(true);
    const sendMessageCall = sendMessageCalls.find((c) => c.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    expect(sendMessageCall!.body.chat_id).toBe("-1002523187907");
    expect(sendMessageCall!.body.text).toBe(node12Output.actions[0].params.text);
    expect(sendMessageCall!.body).not.toHaveProperty("reply_parameters");
    expect(sendMessageCall!.body).not.toHaveProperty("reply_to_message_id");
  });
});
