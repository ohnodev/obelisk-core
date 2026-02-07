/**
 * TelegramMemorySelectorNode – loads recent Telegram conversations and
 * builds a conversation context for inference.
 * Mirrors Python src/core/execution/nodes/telegram_memory_selector.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { RecentBufferManager } from "./memory/bufferManager";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("telegramMemorySelector");

const bufferManager = new RecentBufferManager(10);

export class TelegramMemorySelectorNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const storage = this.getInputValue(
      "storage_instance",
      context,
      undefined
    ) as StorageInterface | undefined;
    const userId = this.getInputValue(
      "user_id",
      context,
      "telegram_user"
    ) as string;

    if (!storage) {
      throw new Error(
        `TelegramMemorySelectorNode ${this.nodeId}: 'storage_instance' is required`
      );
    }

    // Load recent conversation buffer
    const buffer = await bufferManager.getBuffer(userId, storage);
    const recentMessages = buffer.getMessages();

    const formattedMessages = recentMessages.map((m) => ({
      role: m.role === "human" ? "user" : "assistant",
      content: m.content,
    }));

    // Get recent summaries from activity logs, scoped to the current user
    let memories = "";
    try {
      const summaryLogs = await storage.getActivityLogs(
        "telegram_summary",
        20
      );
      if (summaryLogs.length) {
        const userLogs = summaryLogs.filter((l) => {
          const meta = l.metadata as Record<string, unknown> | undefined;
          const summaryUserId =
            (meta as Record<string, any>)?.summary_data?.user_id ??
            (meta as Record<string, any>)?.user_id;
          return summaryUserId === userId;
        });
        memories = userLogs
          .slice(0, 5)
          .map((l) => l.message)
          .join("\n\n");
      }
    } catch (err) {
      logger.warn(
        `TelegramMemorySelectorNode ${this.nodeId}: failed to load summaries – ${err}`
      );
    }

    const conversationContext = {
      messages: formattedMessages,
      memories,
    };

    logger.debug(
      `TelegramMemorySelectorNode ${this.nodeId}: ${formattedMessages.length} messages, ` +
        `memories=${memories.length} chars`
    );

    return {
      memory_context: conversationContext,
      recent_messages: formattedMessages,
      memories,
    };
  }
}
