/**
 * TelegramListenerNode – polls Telegram for new messages via getUpdates.
 * Mirrors Python src/core/execution/nodes/telegram_listener.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("telegramListener");

// Track last update offset per bot token
const lastOffsets: Record<string, number> = {};

export class TelegramListenerNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const botToken =
      (this.metadata.bot_token as string) ||
      process.env.TELEGRAM_BOT_TOKEN ||
      "";
    const chatId =
      (this.metadata.chat_id as string) ||
      process.env.TELEGRAM_CHAT_ID ||
      "";

    if (!botToken) {
      throw new Error(
        `TelegramListenerNode ${this.nodeId}: bot_token is required`
      );
    }

    const offset = lastOffsets[botToken] ?? 0;
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=1&limit=10`;

    try {
      const res = await fetch(url);
      const data = (await res.json()) as Record<string, unknown>;

      if (!data.ok) {
        logger.error(
          `[TelegramListener] API error: ${JSON.stringify(data).slice(0, 300)}`
        );
        return { messages: [], latest_message: null };
      }

      const results = (data.result as Record<string, unknown>[]) ?? [];
      const messages: Array<{
        text: string;
        from: string;
        chat_id: string;
        date: number;
      }> = [];

      for (const update of results) {
        const updateId = update.update_id as number;
        lastOffsets[botToken] = updateId + 1;

        const msg = update.message as Record<string, unknown> | undefined;
        if (!msg) continue;

        const msgChatId = String(
          (msg.chat as Record<string, unknown>)?.id ?? ""
        );

        // Filter by chat_id if specified
        if (chatId && msgChatId !== chatId) continue;

        const text = (msg.text as string) ?? "";
        const from =
          ((msg.from as Record<string, unknown>)?.username as string) ??
          ((msg.from as Record<string, unknown>)?.first_name as string) ??
          "unknown";

        if (text) {
          messages.push({
            text,
            from,
            chat_id: msgChatId,
            date: (msg.date as number) ?? 0,
          });
        }
      }

      const latestMessage = messages.length
        ? messages[messages.length - 1].text
        : null;

      if (messages.length) {
        logger.debug(
          `[TelegramListener] Received ${messages.length} message(s)`
        );
      }

      return {
        messages,
        latest_message: latestMessage,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[TelegramListener] Poll failed: ${msg}`);
      return { messages: [], latest_message: null };
    }
  }
}
