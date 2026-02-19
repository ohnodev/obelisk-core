/**
 * MemorySelectorNode – loads recent conversations + relevant memories and
 * builds a conversation context dict for the InferenceNode.
 * Mirrors Python src/core/execution/nodes/memory_selector.py
 *
 * Inputs:
 *   query: User query string (required, for context selection)
 *   storage_instance: StorageInterface instance (required)
 *   user_id: User identifier (optional, defaults to user_{nodeId})
 *   model: InferenceClient instance (accepts 'model' or 'llm')
 *   enable_recent_buffer: Whether to include recent conversation buffer (default: true)
 *   k: Number of recent message pairs to keep in buffer (default: 10)
 *
 * Outputs:
 *   query: Original query (pass-through for cleaner flow)
 *   context: ConversationContextDict with 'messages' and 'memories'
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface, ActivityLog } from "../../types";
import { InferenceClient, resolveInferenceClient } from "./inference/inferenceClient";
import { RecentBufferManager } from "./memory/bufferManager";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("memorySelector");

// Class-level cache for buffer managers, keyed by (storageInstanceId, k)
let bufferManagerIdCounter = 0;
const storageIdMap = new WeakMap<object, number>();
const bufferManagerCache: Record<string, RecentBufferManager> = {};

function getBufferManager(storage: StorageInterface, k: number): RecentBufferManager {
  let sid = storageIdMap.get(storage);
  if (sid === undefined) {
    sid = bufferManagerIdCounter++;
    storageIdMap.set(storage, sid);
  }
  const cacheKey = `${sid}_${k}`;
  if (!bufferManagerCache[cacheKey]) {
    bufferManagerCache[cacheKey] = new RecentBufferManager(k);
  }
  return bufferManagerCache[cacheKey];
}

export class MemorySelectorNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const query = this.getInputValue("query", context, "") as string;
    const storage = this.getInputValue(
      "storage_instance",
      context,
      undefined
    ) as StorageInterface | undefined;
    let userId = this.getInputValue("user_id", context, null) as
      | string
      | null;
    // Accept both 'model' (from InferenceConfigNode) and 'llm' (legacy); unwrap { model, agent_id } shape
    const modelRaw =
      this.getInputValue("model", context, undefined) ||
      this.getInputValue("llm", context, undefined);
    const agentId =
      modelRaw &&
      typeof modelRaw === "object" &&
      "agent_id" in modelRaw
        ? (modelRaw as { agent_id?: string }).agent_id
        : undefined;
    const model = resolveInferenceClient(modelRaw);
    let enableRecentBuffer = this.getInputValue(
      "enable_recent_buffer",
      context,
      true
    );
    const kRaw = Number(this.getInputValue("k", context, 10));
    const k = Number.isFinite(kRaw) ? kRaw : 10;

    // Resolve template variables
    const queryStr = String(query ?? "");

    // Convert enable_recent_buffer to boolean
    if (typeof enableRecentBuffer === "string") {
      enableRecentBuffer = ["true", "1", "yes", "on"].includes(
        (enableRecentBuffer as string).toLowerCase()
      );
    }
    enableRecentBuffer = Boolean(enableRecentBuffer);

    // Default user_id if not provided
    if (!userId || userId === "") {
      userId = `user_${this.nodeId}`;
    }

    // Validate inputs
    if (!storage) {
      throw new Error(
        "storage_instance is required for MemorySelectorNode"
      );
    }
    if (!queryStr) {
      throw new Error("query is required for MemorySelectorNode");
    }
    if (!model) {
      throw new Error(
        "model/llm is required for MemorySelectorNode. Connect an InferenceConfigNode."
      );
    }

    // Validate k (ensure no NaN propagation)
    const kInt = Math.max(1, Math.floor(k));

    // ── Recent conversation buffer ──────────────────────────────────

    const conversationMessages: Array<{ role: string; content: string }> = [];

    if (enableRecentBuffer) {
      const bufMgr = getBufferManager(storage, kInt);
      const buffer = await bufMgr.getBuffer(String(userId), storage);
      const messages = buffer.getMessages();

      logger.debug(
        `[MemorySelector] Buffer enabled: loaded ${messages.length} messages for user_id=${userId}`
      );

      for (const msg of messages) {
        if (msg.role === "human") {
          conversationMessages.push({ role: "user", content: msg.content });
        } else if (msg.role === "ai") {
          conversationMessages.push({
            role: "assistant",
            content: msg.content,
          });
        }
      }
    } else {
      logger.debug(
        `[MemorySelector] Buffer disabled for user_id=${userId}`
      );
    }

    // ── Load summaries and select relevant memories ─────────────────

    const memoriesParts: string[] = [];

    const allSummaries = await this._loadAllSummaries(
      storage,
      String(userId),
      30
    );

    logger.debug(
      `[MemorySelector] Loaded ${allSummaries.length} summaries for user_id=${userId}`
    );

    if (allSummaries.length > 0) {
      let selectedSummaries: Array<Record<string, unknown>>;

      if (allSummaries.length > 1) {
        selectedSummaries = await this._selectRelevantMemories(
          model,
          agentId,
          queryStr,
          allSummaries,
          5
        );
      } else {
        selectedSummaries = allSummaries;
      }

      // Format selected memories (mirrors Python formatting)
      for (const summaryData of selectedSummaries) {
        const importantFacts =
          (summaryData.importantFacts as unknown[]) ?? [];
        if (importantFacts.length) {
          if (!memoriesParts.length) memoriesParts.push("[Memories]");
          for (const fact of importantFacts) {
            if (typeof fact === "object" && fact !== null) {
              const vals = Object.values(fact as Record<string, unknown>);
              memoriesParts.push(
                `- ${vals.length ? String(vals[0]) : String(fact)}`
              );
            } else {
              memoriesParts.push(`- ${String(fact)}`);
            }
          }
        }

        const userContext =
          (summaryData.userContext as Record<string, unknown>) ?? null;
        if (userContext && typeof userContext === "object") {
          const joined = memoriesParts.join("\n");
          if (!joined.includes("[User Context]")) {
            if (memoriesParts.length) memoriesParts.push(""); // separator
            memoriesParts.push("[User Context]");
          }
          for (const [key, value] of Object.entries(userContext)) {
            const line = `- ${key}: ${value}`;
            if (!memoriesParts.includes(line)) {
              memoriesParts.push(line);
            }
          }
        }
      }
    }

    const memoriesStr = memoriesParts.length
      ? memoriesParts.join("\n")
      : "";

    const contextOutput = {
      messages: conversationMessages,
      memories: memoriesStr,
    };

    logger.debug(
      `[MemorySelector] Final context for user_id=${userId}: ${conversationMessages.length} messages, ${memoriesStr.length} chars of memories`
    );

    return {
      query: queryStr, // Pass through original query
      context: contextOutput,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async _loadAllSummaries(
    storage: StorageInterface,
    userId: string,
    limit: number
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const activities: ActivityLog[] = await storage.getActivityLogs(
        "conversation_summary",
        limit * 2
      );

      const userSummaries: Array<Record<string, unknown>> = [];

      for (const activity of activities) {
        const meta = (activity.metadata ?? {}) as Record<string, unknown>;
        const summaryData = (meta.summary_data ?? {}) as Record<
          string,
          unknown
        >;
        const activityUserId =
          summaryData.user_id ?? meta.user_id ?? null;

        // Match user_id if found in metadata, otherwise fallback to message pattern
        let matches = false;
        if (activityUserId && String(activityUserId) === userId) {
          matches = true;
        } else if (!activityUserId) {
          // Fallback: check message pattern
          if ((activity.message ?? "").endsWith(`user ${userId}`)) {
            matches = true;
          }
        }

        if (matches && summaryData && Object.keys(summaryData).length > 0) {
          userSummaries.push({
            ...summaryData,
            _activity_id: activity.id,
            _created_at: activity.created_at,
          });
          if (userSummaries.length >= limit) break;
        }
      }

      return userSummaries;
    } catch (err) {
      logger.error(`[MemorySelector] Error loading summaries: ${err}`);
      return [];
    }
  }

  private async _selectRelevantMemories(
    model: InferenceClient,
    agentId: string | undefined,
    userQuery: string,
    summaries: Array<Record<string, unknown>>,
    topK: number
  ): Promise<Array<Record<string, unknown>>> {
    if (!summaries.length) return [];
    if (summaries.length <= topK) return summaries;

    try {
      // Format summaries (mirrors Python formatting)
      let summariesText = "";
      for (let i = 0; i < summaries.length; i++) {
        const summary = summaries[i];
        let str = `Memory ${i}:\n`;
        str += `  Summary: ${summary.summary ?? "N/A"}\n`;

        const topics = (summary.keyTopics as unknown[]) ?? [];
        const topicStrs = topics.map((t) =>
          typeof t === "object" && t !== null
            ? String(
                Object.values(t as Record<string, unknown>)[0] ??
                  String(t)
              )
            : String(t)
        );
        str += `  Topics: ${topicStrs.join(", ")}\n`;

        const facts = (summary.importantFacts as unknown[]) ?? [];
        const factStrs = facts.map((f) =>
          typeof f === "object" && f !== null
            ? String(
                Object.values(f as Record<string, unknown>)[0] ??
                  String(f)
              )
            : String(f)
        );
        str += `  Facts: ${factStrs.join(", ")}\n`;

        const userCtx =
          (summary.userContext as Record<string, unknown>) ?? {};
        if (userCtx && Object.keys(userCtx).length) {
          str += `  Context: ${Object.entries(userCtx)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}\n`;
        }
        summariesText += str + "\n";
      }

      const systemPrompt = `You are a memory selector. Your role is to analyze memories and select the ${topK} most relevant ones for a user query.

You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with { and end with }.

Analyze which memories are most relevant to the user query and return a JSON object with:
- selected_indices: Array of 0-based indices of the ${topK} most relevant memories (e.g., [0, 2, 5])
- reason: Brief explanation of why these memories were selected

Example of correct JSON format:
{
  "selected_indices": [0, 2, 5],
  "reason": "Memory 0 discusses the main topic, Memory 2 contains relevant context, Memory 5 has related facts"
}`;

      const query = `User Query: ${userQuery}\n\nAvailable Memories:\n${summariesText}\n\nReturn the indices (0-based) of the ${topK} most relevant memories. Return ONLY the JSON object, nothing else.`;

      const result = await model.generate(
        query,
        systemPrompt,
        0.1, // Low quantum_influence for consistent selection
        800,
        null,
        false,
        agentId
      );

      const selectionText = (result.response ?? "").trim();
      const raw = extractJsonFromLlmResponse(
        selectionText,
        "memory selection"
      );
      const selectionData = Array.isArray(raw) ? ({} as Record<string, unknown>) : raw;

      const selectedIndices =
        (selectionData.selected_indices as number[]) ?? [];

      const selectedMemories: Array<Record<string, unknown>> = [];
      for (const idx of selectedIndices) {
        if (typeof idx === "number" && idx >= 0 && idx < summaries.length) {
          selectedMemories.push(summaries[idx]);
        }
      }

      if (selectedMemories.length) {
        logger.debug(
          `[MemorySelector] Selected ${selectedMemories.length} relevant memories from ${summaries.length} total`
        );
        return selectedMemories;
      }

      // Fallback: return first topK if selection failed
      logger.warning(
        `[MemorySelector] Memory selection returned invalid indices: ${JSON.stringify(selectedIndices)}, falling back to first ${topK}`
      );
      return summaries.slice(0, topK);
    } catch (err) {
      logger.error(`[MemorySelector] Error in memory selection: ${err}`);
      // Fallback: return first topK
      return summaries.slice(0, topK);
    }
  }
}
