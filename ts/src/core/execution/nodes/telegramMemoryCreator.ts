/**
 * TelegramMemoryCreatorNode – stores Telegram messages and creates summaries per chat.
 * Mirrors Python src/core/execution/nodes/telegram_memory_creator.py
 *
 * Unlike regular MemoryCreator which stores Q&A pairs, this stores
 * individual messages with metadata (user_id, username, chat_id).
 * Tracks message count per chat_id and triggers summarization
 * when threshold is reached.
 *
 * Inputs:
 *   message: Message text (required)
 *   user_id: Telegram user ID (required)
 *   username: Telegram username (optional)
 *   chat_id: Telegram chat/group ID (required)
 *   storage_instance: StorageInterface instance (required)
 *   model: InferenceClient instance (required for summarization)
 *
 * Properties:
 *   summarize_threshold: Number of messages before summarizing (default: 50)
 *
 * Outputs:
 *   success: Boolean indicating if message was stored
 *   message_count: Current message count for this chat
 *   summary_created: True if a summary was just created
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { InferenceClient } from "./inference/inferenceClient";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("telegramMemoryCreator");

// Class-level caches (shared across all TelegramMemoryCreatorNode instances)
// storage_instance_id → chat_id → count
const messageCounts: Record<string, Record<string, number>> = {};
// storage_instance_id → chat_id → messages[]
const messageBuffers: Record<
  string,
  Record<string, Array<Record<string, unknown>>>
> = {};

/** Unique ID for a storage instance (uses object identity via a WeakMap). */
let storageIdCounter = 0;
const storageIdMap = new WeakMap<object, string>();
function storageId(instance: StorageInterface): string {
  let id = storageIdMap.get(instance);
  if (!id) {
    id = `storage_${storageIdCounter++}`;
    storageIdMap.set(instance, id);
  }
  return id;
}

export class TelegramMemoryCreatorNode extends BaseNode {
  private _summarizeThreshold: number;

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);
    this._summarizeThreshold = Number(this.metadata.summarize_threshold ?? 50);
  }

  private _getMessageCount(storage: StorageInterface, chatId: string): number {
    const sid = storageId(storage);
    if (!messageCounts[sid]) messageCounts[sid] = {};
    if (messageCounts[sid][chatId] === undefined) messageCounts[sid][chatId] = 0;
    return messageCounts[sid][chatId];
  }

  private _incrementMessageCount(
    storage: StorageInterface,
    chatId: string
  ): number {
    const sid = storageId(storage);
    if (!messageCounts[sid]) messageCounts[sid] = {};
    if (messageCounts[sid][chatId] === undefined) messageCounts[sid][chatId] = 0;
    messageCounts[sid][chatId]++;
    return messageCounts[sid][chatId];
  }

  private _getMessageBuffer(
    storage: StorageInterface,
    chatId: string
  ): Array<Record<string, unknown>> {
    const sid = storageId(storage);
    if (!messageBuffers[sid]) messageBuffers[sid] = {};
    if (!messageBuffers[sid][chatId]) messageBuffers[sid][chatId] = [];
    return messageBuffers[sid][chatId];
  }

  private _addToBuffer(
    storage: StorageInterface,
    chatId: string,
    messageData: Record<string, unknown>
  ): void {
    const buffer = this._getMessageBuffer(storage, chatId);
    buffer.push(messageData);
    // Keep buffer size reasonable (2x threshold)
    const maxSize = this._summarizeThreshold * 2;
    const sid = storageId(storage);
    if (buffer.length > maxSize) {
      messageBuffers[sid][chatId] = buffer.slice(-maxSize);
    }
  }

  private _clearBuffer(storage: StorageInterface, chatId: string): void {
    const sid = storageId(storage);
    if (messageBuffers[sid]?.[chatId]) {
      messageBuffers[sid][chatId] = [];
    }
  }

  private async _summarizeMessages(
    llm: InferenceClient,
    messages: Array<Record<string, unknown>>
  ): Promise<Record<string, unknown> | null> {
    if (!messages.length) return null;

    try {
      // Format messages for summarization
      let conversationText = "";
      for (const msg of messages) {
        const username =
          (msg.username as string) || (msg.user_id as string) || "Unknown";
        const text = (msg.message as string) || "";
        conversationText += `[${username}]: ${text}\n`;
      }

      const systemPrompt = `You are a memory extraction system for Telegram group chats. Your role is to analyze chat messages and extract structured information as JSON.

You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with { and end with }.

Extract and structure the following information as JSON with these EXACT keys:
- summary: A brief 2-3 sentence overview of what was discussed in this chat segment
- keyTopics: Array of main topics discussed (e.g., ["crypto", "AI", "memes"])
- activeUsers: Array of usernames/user_ids that were most active
- sentiment: Overall sentiment of the conversation ("positive", "neutral", "negative", "mixed")
- importantMessages: Array of particularly important or notable messages (max 5)

Example of correct JSON format:
{
  "summary": "The group discussed upcoming NFT drops and debated AI capabilities. Several users shared memes.",
  "keyTopics": ["NFTs", "artificial intelligence", "memes"],
  "activeUsers": ["user123", "cryptofan", "aidev"],
  "sentiment": "positive",
  "importantMessages": ["Check out the new collection dropping tomorrow", "AI is getting scary good"]
}`;

      const query = `Summarize these Telegram messages:\n\n${conversationText}\n\nReturn ONLY the JSON object, nothing else.`;

      const result = await llm.generate(
        query,
        systemPrompt,
        0.2, // Low quantum_influence for consistent summaries
        800, // Enough tokens for JSON
        null, // No conversation history
        false // No thinking mode
      );

      const summaryText = (result.response ?? "").trim();
      const raw = extractJsonFromLlmResponse(summaryText, "telegram_summary");
      const summaryData = Array.isArray(raw) ? null : (raw as Record<string, unknown>);
      return summaryData;
    } catch (err) {
      logger.error(`Error summarizing Telegram messages: ${err}`);
      return null;
    }
  }

  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const message = this.getInputValue("message", context, "") as string;
    const userId = this.getInputValue("user_id", context, "") as string;
    const username = this.getInputValue("username", context, "") as string;
    const chatId = this.getInputValue("chat_id", context, "") as string;
    const messageIdRaw = this.getInputValue("message_id", context, undefined);
    const num =
      messageIdRaw != null && messageIdRaw !== ""
        ? Number(messageIdRaw)
        : NaN;
    const messageId =
      Number.isFinite(num) && num > 0 && Math.floor(num) === num
        ? num
        : undefined;
    const storage = this.getInputValue(
      "storage_instance",
      context,
      undefined
    ) as StorageInterface | undefined;
    const llm = this.getInputValue("model", context, undefined) as
      | InferenceClient
      | undefined;

    // Normalize message to string immediately
    const messageStr = message ? String(message) : "";

    // Get threshold from metadata and normalize
    let summarizeThreshold = Number(this.metadata.summarize_threshold ?? 50);
    if (summarizeThreshold < 5) summarizeThreshold = 5;
    this._summarizeThreshold = summarizeThreshold;

    // Validate required inputs
    if (!messageStr) {
      logger.warning("[TelegramMemoryCreator] No message provided");
      return { success: false, message_count: 0, summary_created: false };
    }

    const userIdStr = userId ? String(userId) : "";
    if (!userIdStr) {
      logger.warning("[TelegramMemoryCreator] No user_id provided");
      return { success: false, message_count: 0, summary_created: false };
    }

    if (!chatId) {
      logger.warning("[TelegramMemoryCreator] No chat_id provided");
      return { success: false, message_count: 0, summary_created: false };
    }

    if (!storage) {
      throw new Error(
        "storage_instance is required for TelegramMemoryCreatorNode"
      );
    }

    // Create message data (include message_id so storage can resolve message_id → user_id / username later)
    const messageData: Record<string, unknown> = {
      message: messageStr,
      user_id: userId ? String(userId) : "",
      username: username ? String(username) : "",
      chat_id: String(chatId),
      timestamp: Date.now() / 1000,
      type: "telegram_message",
    };
    // Persist message_id so memory selector and TG action can show/resolve it (required for delete/pin/timeout by context)
    if (typeof messageId === "number" && Number.isFinite(messageId)) {
      messageData.message_id = messageId;
    }

    // Save individual message to storage FIRST, then buffer on success
    try {
      const displayMsg =
        messageStr.length > 100 ? messageStr.slice(0, 100) + "..." : messageStr;
      const displayUser = username || userId;
      await storage.createActivityLog("telegram_message", `[${displayUser}] ${displayMsg}`, messageData);
      logger.info(
        `[TelegramMemoryCreator] Saved message from ${displayUser} in chat ${chatId}: ${messageStr.slice(0, 50)}...`
      );
    } catch (err) {
      logger.error(`[TelegramMemoryCreator] Failed to save message: ${err}`);
      return { success: false, message_count: 0, summary_created: false };
    }

    // Add to buffer only after successful persistence
    this._addToBuffer(storage, String(chatId), messageData);

    // Increment count and check threshold
    const messageCount = this._incrementMessageCount(storage, String(chatId));
    const shouldSummarize =
      messageCount > 0 && messageCount % summarizeThreshold === 0;
    let summaryCreated = false;

    if (shouldSummarize && llm) {
      logger.info(
        `[TelegramMemoryCreator] Summarizing ${summarizeThreshold} messages for chat ${chatId}`
      );

      // Get messages to summarize
      const buffer = this._getMessageBuffer(storage, String(chatId));
      const messagesToSummarize = buffer.slice(-summarizeThreshold);

      // Create summary
      const summaryData = await this._summarizeMessages(
        llm,
        messagesToSummarize
      );

      if (summaryData) {
        // Add metadata
        summaryData.chat_id = String(chatId);
        summaryData.message_count = summarizeThreshold;
        summaryData.timestamp = Date.now() / 1000;

        // Save summary to storage (wrapped in try/catch to preserve buffer on failure)
        try {
          const summaryText = (summaryData.summary as string) ?? "";
          const displaySummary =
            summaryText.length > 100
              ? summaryText.slice(0, 100) + "..."
              : summaryText;
          await storage.createActivityLog(
            "telegram_summary",
            `Chat summary for ${chatId}: ${displaySummary}`,
            summaryData
          );

          // Only clear buffer after successful persistence
          this._clearBuffer(storage, String(chatId));

          summaryCreated = true;
          logger.info(
            `[TelegramMemoryCreator] Created summary for chat ${chatId}`
          );
        } catch (err) {
          // Don't clear buffer so it's available for retry on next threshold hit
          logger.error(
            `[TelegramMemoryCreator] Failed to persist summary for chat ${chatId}: ${err}`
          );
        }
      } else {
        logger.warning(
          `[TelegramMemoryCreator] Failed to create summary for chat ${chatId}`
        );
      }
    }

    return {
      success: true,
      message_count: messageCount,
      summary_created: summaryCreated,
    };
  }
}
