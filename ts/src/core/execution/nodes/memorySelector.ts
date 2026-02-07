/**
 * MemorySelectorNode – loads recent conversations + relevant memories and
 * builds a conversation context dict for the InferenceNode.
 * Mirrors Python src/core/execution/nodes/memory_selector.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { InferenceClient } from "./inference/inferenceClient";
import { RecentBufferManager } from "./memory/bufferManager";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("memorySelector");

// Shared buffer manager
const bufferManager = new RecentBufferManager(10);

export class MemorySelectorNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const storage = this.getInputValue(
      "storage_instance",
      context,
      undefined
    ) as StorageInterface | undefined;
    const model = this.getInputValue("model", context, undefined) as
      | InferenceClient
      | undefined;
    const userQuery = this.getInputValue(
      "user_query",
      context,
      undefined
    ) as string | undefined;
    const userId = this.getInputValue(
      "user_id",
      context,
      "default_user"
    ) as string;

    if (!storage) {
      throw new Error(
        `MemorySelectorNode ${this.nodeId}: 'storage_instance' input is required. Connect a MemoryStorageNode.`
      );
    }

    // Load recent conversation buffer
    const buffer = await bufferManager.getBuffer(userId, storage);
    const recentMessages = buffer.getMessages();

    // Format recent messages for the prompt
    const formattedMessages = recentMessages.map((m) => ({
      role: m.role === "human" ? "user" : "assistant",
      content: m.content,
    }));

    // Get relevant memories via LLM-based selection
    let memories = "";
    if (model && userQuery && recentMessages.length > 0) {
      try {
        memories = await this.selectRelevantMemories(
          model,
          userQuery,
          recentMessages.map((m) => m.content),
          storage,
          userId
        );
      } catch (err) {
        logger.warn(
          `MemorySelectorNode ${this.nodeId}: memory selection failed – ${err}`
        );
      }
    }

    // Build conversation context
    const conversationContext = {
      messages: formattedMessages,
      memories,
    };

    logger.debug(
      `MemorySelectorNode ${this.nodeId}: ${formattedMessages.length} messages, ` +
        `memories=${memories.length} chars`
    );

    return {
      memory_context: conversationContext,
      recent_messages: formattedMessages,
      memories,
    };
  }

  private async selectRelevantMemories(
    model: InferenceClient,
    userQuery: string,
    recentTexts: string[],
    storage: StorageInterface,
    userId: string
  ): Promise<string> {
    // Get recent activity logs for summary material
    const activities = await storage.getActivityLogs(undefined, 20);
    if (!activities.length) return "";

    const summaryTexts = activities
      .filter((a) => {
        if (a.type !== "telegram_summary" && a.type !== "conversation_summary") return false;
        // Scope to current user: check summary_data.user_id first, fall back to user_id
        const meta = a.metadata as Record<string, unknown> | undefined;
        const summaryUserId =
          (meta?.summary_data as Record<string, unknown> | undefined)?.user_id ??
          meta?.user_id;
        // Include if no user info stored (legacy) or if it matches the current user
        return !summaryUserId || summaryUserId === userId;
      })
      .map((a) => a.message)
      .slice(0, 5);

    if (!summaryTexts.length) return "";

    // Ask the model to select relevant memories
    const prompt = [
      "You are a memory selector. Given the user's current query and available memory summaries,",
      "select which memories are relevant to the current conversation.",
      "",
      `User query: ${userQuery}`,
      "",
      "Available memories:",
      ...summaryTexts.map((s, i) => `[${i}] ${s.slice(0, 200)}`),
      "",
      'Respond with JSON: {"selected_indices": [0, 1, ...], "reasoning": "..."}',
      "JSON:",
    ].join("\n");

    const result = await model.generate(prompt, {
      enableThinking: false,
      maxLength: 200,
    });

    if (!result.response) return "";

    try {
      const parsed = extractJsonFromLlmResponse(
        result.response,
        "memory_selection"
      );
      const indices = (parsed.selected_indices as number[]) ?? [];
      return indices
        .filter((i) => i >= 0 && i < summaryTexts.length)
        .map((i) => summaryTexts[i])
        .join("\n\n");
    } catch {
      return "";
    }
  }
}
