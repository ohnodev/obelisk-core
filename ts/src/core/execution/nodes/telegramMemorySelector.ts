/**
 * TelegramMemorySelectorNode – retrieves relevant context for a Telegram chat.
 * Mirrors Python src/core/execution/nodes/telegram_memory_selector.py
 *
 * Inputs:
 *   message: The incoming message (optional, passed through)
 *   chat_id: Telegram chat/group ID to filter by (required)
 *   storage_instance: StorageInterface instance (required)
 *   model: InferenceClient (optional, for future semantic search)
 *
 * Properties:
 *   recent_count: Number of recent messages to include (default: 20)
 *   include_summaries: Whether to include summaries (default: true)
 *
 * Outputs:
 *   context: Combined context string (summaries + recent messages)
 *   recent_messages: Formatted recent messages string
 *   summaries: Formatted summaries string
 *   message: Original message passed through (for chaining to next node)
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("telegramMemorySelector");

interface ChatMessage {
  message: string;
  user_id: string;
  username: string;
  timestamp: number;
}

interface ChatSummary {
  summary: string;
  keyTopics: string[];
  sentiment: string;
  timestamp: number;
}

export class TelegramMemorySelectorNode extends BaseNode {
  private _recentCount: number;
  private _includeSummaries: boolean;

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);
    this._recentCount = Number(this.metadata.recent_count ?? 20);
    this._includeSummaries = this.metadata.include_summaries !== false;
  }

  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const message = this.getInputValue("message", context, "") as string;
    const chatId = this.getInputValue("chat_id", context, "") as string;
    const storageInstance = this.getInputValue(
      "storage_instance",
      context,
      undefined
    ) as StorageInterface | undefined;

    // Validate required inputs
    if (!chatId) {
      logger.warning("[TelegramMemorySelector] No chat_id provided");
      return {
        context: "",
        recent_messages: "",
        summaries: "",
        message: message ? String(message) : "",
      };
    }

    if (!storageInstance) {
      throw new Error(
        "storage_instance is required for TelegramMemorySelectorNode"
      );
    }

    // Fetch recent messages
    const messages = await this._getRecentMessages(
      storageInstance,
      String(chatId),
      this._recentCount
    );
    const recentMessagesText = this._formatMessages(messages);

    // Fetch summaries if enabled
    let summariesText = "";
    let summaryCount = 0;
    if (this._includeSummaries) {
      const summaries = await this._getSummaries(
        storageInstance,
        String(chatId)
      );
      summariesText = this._formatSummaries(summaries);
      summaryCount = summaries.length;
    }

    // Combine into context
    const contextParts: string[] = [];
    if (summariesText) contextParts.push(summariesText);
    if (recentMessagesText) contextParts.push(recentMessagesText);

    const combinedContext = contextParts.length
      ? contextParts.join("\n\n")
      : "No chat history available.";

    logger.info(
      `[TelegramMemorySelector] Retrieved ${messages.length} messages and ${summaryCount} summaries for chat ${chatId}`
    );

    return {
      context: combinedContext,
      recent_messages: recentMessagesText,
      summaries: summariesText,
      message: message ? String(message) : "",
    };
  }

  // ── Private helpers ────────────────────────────────────────────────

  private async _getRecentMessages(
    storage: StorageInterface,
    chatId: string,
    count: number
  ): Promise<ChatMessage[]> {
    try {
      const logs = await storage.getActivityLogs("telegram_message", count * 2);
      const chatMessages: ChatMessage[] = [];

      for (const log of logs) {
        const meta = (log.metadata ?? {}) as Record<string, unknown>;
        if (String(meta.chat_id ?? "") === chatId) {
          chatMessages.push({
            message: String(meta.message ?? ""),
            user_id: String(meta.user_id ?? ""),
            username: String(meta.username ?? ""),
            timestamp: Number(
              meta.timestamp ?? (log.created_at ? new Date(log.created_at).getTime() / 1000 : 0)
            ),
          });
          if (chatMessages.length >= count) break;
        }
      }

      // Sort by timestamp (newest last for chronological order)
      chatMessages.sort((a, b) => a.timestamp - b.timestamp);
      return chatMessages;
    } catch (err) {
      logger.error(
        `[TelegramMemorySelector] Error fetching messages: ${err}`
      );
      return [];
    }
  }

  private async _getSummaries(
    storage: StorageInterface,
    chatId: string,
    limit = 5
  ): Promise<ChatSummary[]> {
    try {
      const logs = await storage.getActivityLogs(
        "telegram_summary",
        limit * 2
      );
      const chatSummaries: ChatSummary[] = [];

      for (const log of logs) {
        const meta = (log.metadata ?? {}) as Record<string, unknown>;
        if (String(meta.chat_id ?? "") === chatId) {
          chatSummaries.push({
            summary: String(meta.summary ?? ""),
            keyTopics: (meta.keyTopics as string[]) ?? [],
            sentiment: String(meta.sentiment ?? ""),
            timestamp: Number(
              meta.timestamp ?? (log.created_at ? new Date(log.created_at).getTime() / 1000 : 0)
            ),
          });
          if (chatSummaries.length >= limit) break;
        }
      }

      // Sort by timestamp (most recent first)
      chatSummaries.sort((a, b) => b.timestamp - a.timestamp);
      return chatSummaries;
    } catch (err) {
      logger.error(
        `[TelegramMemorySelector] Error fetching summaries: ${err}`
      );
      return [];
    }
  }

  private _formatMessages(messages: ChatMessage[]): string {
    if (!messages.length) return "";
    const lines = ["=== Recent Messages ==="];
    for (const msg of messages) {
      const username = msg.username || msg.user_id || "Unknown";
      lines.push(`[${username}]: ${msg.message}`);
    }
    return lines.join("\n");
  }

  private _formatSummaries(summaries: ChatSummary[]): string {
    if (!summaries.length) return "";
    const lines = ["=== Chat Summaries ==="];
    for (let i = 0; i < summaries.length; i++) {
      const s = summaries[i];
      lines.push(`\n--- Summary ${i + 1} ---`);
      lines.push(s.summary || "No summary available");
      if (s.keyTopics.length) {
        lines.push(`Topics: ${s.keyTopics.join(", ")}`);
      }
      if (s.sentiment) {
        lines.push(`Sentiment: ${s.sentiment}`);
      }
    }
    return lines.join("\n");
  }
}
