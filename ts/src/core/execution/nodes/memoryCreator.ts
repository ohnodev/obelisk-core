/**
 * MemoryCreatorNode – saves the current interaction (query + response) to storage,
 * tracks interaction counts, manages recent buffers, and triggers summarization.
 * Mirrors Python src/core/execution/nodes/memory_creator.py
 *
 * Inputs:
 *   storage_instance: StorageInterface instance (required)
 *   query: User query string (required)
 *   response: AI response string (required)
 *   user_id: User identifier (optional, defaults to user_{nodeId})
 *   model: InferenceClient instance (accepts 'model' or 'llm')
 *   summarize_threshold: Number of interactions before summarizing (default: 3)
 *   previous_interactions: List of previous interactions for summarization (optional)
 *   cycle_id: Evolution cycle ID (optional)
 *   quantum_seed: Quantum seed value (optional, default: 0.7)
 *   k: Number of recent message pairs to keep in buffer (default: 10)
 *
 * Outputs:
 *   {} (empty – saves directly to storage, matching Python)
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { InferenceClient } from "./inference/inferenceClient";
import { RecentBufferManager } from "./memory/bufferManager";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("memoryCreator");

// Class-level cache for interaction counts: storageInstanceId → userId → count
let storageIdCounter = 0;
const storageIdMap = new WeakMap<object, number>();
const interactionCounts: Record<number, Record<string, number>> = {};

// Class-level cache for buffer managers
const bufferManagerCache: Record<string, RecentBufferManager> = {};

function getStorageId(storage: StorageInterface): number {
  let sid = storageIdMap.get(storage);
  if (sid === undefined) {
    sid = storageIdCounter++;
    storageIdMap.set(storage, sid);
  }
  return sid;
}

function getBufferManager(
  storage: StorageInterface,
  k: number
): RecentBufferManager {
  const sid = getStorageId(storage);
  const cacheKey = `${sid}_${k}`;
  if (!bufferManagerCache[cacheKey]) {
    bufferManagerCache[cacheKey] = new RecentBufferManager(k);
  }
  return bufferManagerCache[cacheKey];
}

export class MemoryCreatorNode extends BaseNode {
  private _getInteractionCount(
    storage: StorageInterface,
    userId: string
  ): number {
    const sid = getStorageId(storage);
    if (!interactionCounts[sid]) interactionCounts[sid] = {};
    if (interactionCounts[sid][userId] === undefined)
      interactionCounts[sid][userId] = 0;
    return interactionCounts[sid][userId];
  }

  private _incrementInteractionCount(
    storage: StorageInterface,
    userId: string
  ): void {
    const sid = getStorageId(storage);
    if (!interactionCounts[sid]) interactionCounts[sid] = {};
    if (interactionCounts[sid][userId] === undefined)
      interactionCounts[sid][userId] = 0;
    interactionCounts[sid][userId]++;
  }

  private async _summarizeConversations(
    llm: InferenceClient,
    interactions: Array<Record<string, unknown>>,
    _userId?: string
  ): Promise<Record<string, unknown> | null> {
    if (!interactions.length) return null;

    try {
      // Format conversations
      let conversationText = "";
      for (const interaction of interactions) {
        const query = (interaction.query as string) ?? "";
        const response = (interaction.response as string) ?? "";
        if (query) conversationText += `User: ${query}\n`;
        if (response) conversationText += `Overseer: ${response}\n`;
      }

      const systemPrompt = `You are a memory extraction system. Your role is to analyze conversations and extract structured information as JSON.

You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with { and end with }.

Extract and structure the following information as JSON with these EXACT keys:
- summary: A brief 1-2 sentence overview of the conversation
- keyTopics: Array of main topics discussed (e.g., ["AI", "quantum computing", "memory systems"])
- userContext: Object containing any user preferences, settings, or context mentioned (e.g., {"preferred_language": "English", "timezone": "UTC"})
- importantFacts: Array of factual statements extracted from the conversation (e.g., ["Current year is 2026", "User prefers concise responses"])

Example of correct JSON format:
{
  "summary": "Discussion about AI memory systems and their implementation",
  "keyTopics": ["artificial intelligence", "memory architecture", "neural networks"],
  "userContext": {"preferred_format": "technical", "current_year": 2026},
  "importantFacts": ["Current year is 2026", "Memory systems use JSON for storage", "Neural networks require structured data"]
}`;

      const query = `Extract memories from this conversation:\n\n${conversationText}\n\nReturn ONLY the JSON object, nothing else.`;

      const result = await llm.generate(
        query,
        systemPrompt,
        0.2, // Lower influence for consistent summaries
        800,
        null,
        false
      );

      const summaryText = (result.response ?? "").trim();
      const summaryData = extractJsonFromLlmResponse(
        summaryText,
        "summary"
      );
      return summaryData;
    } catch (err) {
      logger.error(`[MemoryCreator] Error summarizing with LLM: ${err}`);
      return null;
    }
  }

  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const storage = this.getInputValue(
      "storage_instance",
      context,
      undefined
    ) as StorageInterface | undefined;
    const query = this.getInputValue("query", context, "") as string;
    const response = this.getInputValue("response", context, "") as string;
    let userId = this.getInputValue("user_id", context, null) as
      | string
      | null;
    // Accept both 'model' (from InferenceConfigNode) and 'llm' (legacy)
    const llm =
      (this.getInputValue("model", context, undefined) as
        | InferenceClient
        | undefined) ||
      (this.getInputValue("llm", context, undefined) as
        | InferenceClient
        | undefined);
    const summarizeThresholdRaw = this.getInputValue(
      "summarize_threshold",
      context,
      3
    );
    const previousInteractions = this.getInputValue(
      "previous_interactions",
      context,
      null
    ) as Array<Record<string, unknown>> | null;
    const cycleId =
      (this.getInputValue("cycle_id", context, null) as string | null) ??
      null;
    const quantumSeed = Number(
      this.getInputValue("quantum_seed", context, 0.7)
    );
    const k = Number(this.getInputValue("k", context, 10));

    // Validate and normalize summarize_threshold
    let summarizeThreshold: number;
    try {
      summarizeThreshold = Number(summarizeThresholdRaw);
      if (isNaN(summarizeThreshold) || summarizeThreshold < 1) {
        logger.warning(
          `[MemoryCreator] summarize_threshold (${summarizeThresholdRaw}) is invalid, defaulting to 3`
        );
        summarizeThreshold = 3;
      }
    } catch {
      logger.warning(
        `[MemoryCreator] Invalid summarize_threshold value (${summarizeThresholdRaw}), defaulting to 3`
      );
      summarizeThreshold = 3;
    }
    summarizeThreshold = Math.floor(summarizeThreshold);

    // Validate required inputs
    if (!storage) {
      throw new Error(
        "storage_instance is required for MemoryCreatorNode. Connect a MemoryStorageNode first."
      );
    }

    if (!query || !response) {
      throw new Error(
        "query and response are required for MemoryCreatorNode"
      );
    }

    // Default user_id if not provided
    if (!userId || userId === "") {
      userId = `user_${this.nodeId}`;
      logger.warning(
        `[MemoryCreator] user_id was empty, defaulting to ${userId}`
      );
    }

    if (!llm) {
      throw new Error(
        "model/llm is required for MemoryCreatorNode. Connect an InferenceConfigNode."
      );
    }

    // Get current cycle if not provided
    let resolvedCycleId = cycleId;
    if (!resolvedCycleId) {
      try {
        resolvedCycleId = await storage.getCurrentEvolutionCycle();
      } catch (err) {
        logger.warning(
          `[MemoryCreator] Failed to get current evolution cycle: ${err}. Continuing with null.`
        );
        resolvedCycleId = null;
      }
    }

    // Save interaction to storage
    logger.debug(
      `[MemoryCreator] Saving interaction for user_id=${userId}: query='${String(query).slice(0, 50)}...', response='${String(response).slice(0, 50)}...'`
    );
    await storage.saveInteraction({
      userId: String(userId),
      query: String(query),
      response: String(response),
      cycleId: resolvedCycleId ?? undefined,
      quantumSeed,
    });
    logger.debug(
      `[MemoryCreator] Interaction saved successfully for user_id=${userId}`
    );

    // Add to recent conversation buffer
    const kInt = Math.max(1, Math.floor(k));
    const bufMgr = getBufferManager(storage, kInt);
    const buffer = await bufMgr.getBuffer(String(userId), storage);

    // Check for duplication: get_buffer reloads from storage,
    // so it likely already includes the interaction we just saved
    const messages = buffer.getMessages();
    let shouldAdd = true;
    if (messages.length >= 2) {
      const lastTwo = messages.slice(-2);
      if (
        lastTwo[0]?.role === "human" &&
        lastTwo[1]?.role === "ai" &&
        lastTwo[0].content === String(query) &&
        lastTwo[1].content === String(response)
      ) {
        shouldAdd = false;
        logger.debug(
          `[MemoryCreator] Buffer already contains this interaction, skipping duplicate`
        );
      }
    }

    if (shouldAdd) {
      buffer.addUserMessage(String(query));
      buffer.addAiMessage(String(response));
    }

    // Update interaction count
    this._incrementInteractionCount(storage, String(userId));
    const interactionCount = this._getInteractionCount(
      storage,
      String(userId)
    );

    // Check if we should summarize (every N interactions)
    const shouldSummarize =
      interactionCount > 0 &&
      interactionCount % summarizeThreshold === 0;

    // Create and save summary if threshold reached
    if (shouldSummarize && previousInteractions) {
      const summaryData = await this._summarizeConversations(
        llm,
        previousInteractions,
        String(userId)
      );

      if (summaryData) {
        // Add metadata to summary
        summaryData.interactions_count = previousInteractions.length;
        summaryData.user_id = String(userId);

        // Save summary to storage
        const metadata: Record<string, unknown> = {
          summary_text: (summaryData.summary as string) ?? "",
          summary_data: summaryData,
          interactions_count: summaryData.interactions_count,
        };

        await storage.createActivityLog(
          "conversation_summary",
          `Conversation summary for user ${userId}`,
          metadata
        );
      }
    }

    // No outputs – saves directly to storage (matching Python)
    return {};
  }
}
