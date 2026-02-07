/**
 * TelegramMemorySelectorNode – retrieves relevant context for a Telegram chat.
 * Mirrors Python src/core/execution/nodes/telegram_memory_selector.py
 *
 * When multiple summaries are available, uses the LLM (non-thinking) to select
 * the most relevant ones — just like the regular MemorySelectorNode.
 *
 * Inputs:
 *   message: The incoming message (optional, passed through)
 *   chat_id: Telegram chat/group ID to filter by (required)
 *   storage_instance: StorageInterface instance (required)
 *   model: InferenceClient (optional, used for intelligent summary selection)
 *
 * Properties:
 *   recent_count: Number of recent messages to include (default: 20)
 *   include_summaries: Whether to include summaries (default: true)
 *
 * Outputs:
 *   context: Combined context string (selected summaries + recent messages)
 *   recent_messages: Formatted recent messages string
 *   summaries: Formatted summaries string
 *   message: Original message passed through (for chaining to next node)
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { InferenceClient } from "./inference/inferenceClient";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
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
  importantMessages?: string[];
  activeUsers?: string[];
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
    const model = this.getInputValue("model", context, undefined) as
      | InferenceClient
      | undefined;

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

    // Fetch summaries if enabled — with LLM-based selection when available
    let summariesText = "";
    let summaryCount = 0;
    if (this._includeSummaries) {
      const allSummaries = await this._getSummaries(
        storageInstance,
        String(chatId),
        10 // Fetch more than we need so we can select
      );
      summaryCount = allSummaries.length;

      if (allSummaries.length > 0) {
        let selectedSummaries: ChatSummary[];

        // Use LLM to select relevant summaries when we have more than topK and a model
        const topK = 5;
        if (allSummaries.length > topK && model && message) {
          logger.info(
            `[TelegramMemorySelector] Using LLM to select ${topK} relevant summaries from ${allSummaries.length} candidates`
          );
          selectedSummaries = await this._selectRelevantSummaries(
            model,
            String(message),
            allSummaries,
            topK
          );
        } else {
          if (allSummaries.length > 1) {
            logger.info(
              `[TelegramMemorySelector] ${allSummaries.length} summaries (≤${topK}) — using all without LLM selection`
            );
          }
          selectedSummaries = allSummaries;
        }

        summariesText = this._formatSummaries(selectedSummaries);
      }
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

  /**
   * Use LLM (non-thinking) to select the most relevant summaries for the
   * current message. Mirrors the regular MemorySelectorNode._selectRelevantMemories.
   */
  private async _selectRelevantSummaries(
    model: InferenceClient,
    userMessage: string,
    summaries: ChatSummary[],
    topK: number
  ): Promise<ChatSummary[]> {
    if (!summaries.length) return [];
    if (summaries.length <= topK) return summaries;

    try {
      // Format summaries for LLM analysis
      let summariesText = "";
      for (let i = 0; i < summaries.length; i++) {
        const s = summaries[i];
        let str = `Summary ${i}:\n`;
        str += `  Content: ${s.summary || "N/A"}\n`;
        if (s.keyTopics.length) {
          str += `  Topics: ${s.keyTopics.join(", ")}\n`;
        }
        if (s.sentiment) {
          str += `  Sentiment: ${s.sentiment}\n`;
        }
        if (s.importantMessages?.length) {
          str += `  Key messages: ${s.importantMessages.slice(0, 3).join("; ")}\n`;
        }
        summariesText += str + "\n";
      }

      const systemPrompt = `You are a memory selector for a Telegram chat agent. Your role is to select the ${topK} most relevant chat summaries given the current incoming message.

You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with { and end with }.

Analyze which summaries are most relevant and return a JSON object with:
- selected_indices: Array of 0-based indices of the ${topK} most relevant summaries (e.g., [0, 2, 5])
- reason: Brief explanation of why these summaries were selected

Example of correct JSON format:
{
  "selected_indices": [0, 2, 5],
  "reason": "Summary 0 discusses the main topic, Summary 2 has relevant context"
}`;

      const query = `Current message: ${userMessage}\n\nAvailable Chat Summaries:\n${summariesText}\nReturn the indices (0-based) of the ${topK} most relevant summaries. Return ONLY the JSON object, nothing else.`;

      logger.info(
        `[TelegramMemorySelector] Calling inference for summary selection (${summaries.length} candidates)`
      );

      const result = await model.generate(
        query,
        systemPrompt,
        0.1, // Low quantum_influence for consistent selection
        800,
        null,
        false // Non-thinking for fast selection
      );

      const selectionText = (result.response ?? "").trim();
      const selectionData = extractJsonFromLlmResponse(
        selectionText,
        "telegram_memory_selection"
      );

      const selectedIndices =
        (selectionData.selected_indices as number[]) ?? [];

      const selectedSummaries: ChatSummary[] = [];
      for (const idx of selectedIndices) {
        if (typeof idx === "number" && idx >= 0 && idx < summaries.length) {
          selectedSummaries.push(summaries[idx]);
        }
      }

      if (selectedSummaries.length) {
        logger.info(
          `[TelegramMemorySelector] LLM selected ${selectedSummaries.length} relevant summaries from ${summaries.length} total`
        );
        return selectedSummaries;
      }

      // Fallback: return first topK if LLM selection returned invalid indices
      logger.warning(
        `[TelegramMemorySelector] LLM selection returned invalid indices: ${JSON.stringify(selectedIndices)}, falling back to first ${topK}`
      );
      return summaries.slice(0, topK);
    } catch (err) {
      logger.error(
        `[TelegramMemorySelector] Error in LLM summary selection: ${err}`
      );
      // Fallback: return first topK
      return summaries.slice(0, topK);
    }
  }

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
    limit = 10
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
            importantMessages: (meta.importantMessages as string[]) ?? [],
            activeUsers: (meta.activeUsers as string[]) ?? [],
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
