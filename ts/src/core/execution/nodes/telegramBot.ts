/**
 * TelegramBotNode – sends a message to Telegram via the Bot API.
 * Mirrors Python src/core/execution/nodes/telegram_bot.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("telegramBot");

export class TelegramBotNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const message = this.getInputValue("message", context, undefined) as
      | string
      | undefined;
    const botToken =
      (this.getInputValue("bot_id", context, undefined) as string) ||
      (this.getInputValue("bot_token", context, undefined) as string) ||
      (this.resolveEnvVar(this.metadata.bot_id) as string) ||
      (this.resolveEnvVar(this.metadata.bot_token) as string) ||
      process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      "";
    const chatId =
      (this.getInputValue("chat_id", context, undefined) as string) ||
      (this.resolveEnvVar(this.metadata.chat_id) as string) ||
      process.env.TELEGRAM_CHAT_ID ||
      "";

    // Gracefully handle gated messages (e.g. BinaryIntentNode returned null)
    if (!message) {
      logger.debug(
        `[TelegramBot] No message provided (likely gated by BinaryIntent), skipping send for node ${this.nodeId}`
      );
      return {
        success: false,
        response: { error: "No message provided, skipped." },
      };
    }

    if (!botToken) {
      throw new Error(
        `TelegramBotNode ${this.nodeId}: bot_token is required`
      );
    }
    if (!chatId) {
      throw new Error(
        `TelegramBotNode ${this.nodeId}: chat_id is required`
      );
    }

    // Optional message_id for quote-replying
    const replyToMessageId =
      (this.getInputValue("message_id", context, undefined) as number | string | undefined);
    const replyId = replyToMessageId ? Number(replyToMessageId) : undefined;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    // Build payload — include reply_to_message_id when available
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    };
    if (replyId && Number.isFinite(replyId)) {
      payload.reply_parameters = { message_id: replyId };
    }

    try {
      let res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data = (await res.json()) as Record<string, unknown>;

      // If quote-reply failed (e.g. message deleted), retry without it
      if ((!res.ok || !data.ok) && payload.reply_parameters) {
        logger.warn(
          `[TelegramBot] Quote-reply failed (message_id=${replyId}), retrying without reply: ${(data as any).description ?? ""}`
        );
        delete payload.reply_parameters;
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        data = (await res.json()) as Record<string, unknown>;
      }

      if (!res.ok || !data.ok) {
        logger.error(
          `[TelegramBot] API error: ${JSON.stringify(data).slice(0, 300)}`
        );
        return { success: false, response: data };
      }

      logger.debug(
        `[TelegramBot] Message sent to chat ${chatId} (${message.length} chars)${replyId ? ` reply_to=${replyId}` : ""}`
      );
      return { success: true, response: data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[TelegramBot] Failed to send: ${msg}`);
      return { success: false, response: { error: msg } };
    }
  }
}
