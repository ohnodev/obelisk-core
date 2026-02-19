/**
 * InferenceNode – sends a prompt to the LLM (via InferenceClient) and returns
 * the response.
 * Mirrors Python src/core/execution/nodes/inference/node.py
 *
 * Inputs:
 *   trigger: boolean (optional, default true) – when false, skips the API call and returns
 *     empty response/outputs so downstream nodes (e.g. http_response) still run.
 *   model: InferenceClient (from InferenceConfigNode) – required
 *   system_prompt: System prompt (from connected TextNode or widget) – required
 *   query: User query string – required
 *   context: Conversation context from MemorySelectorNode (optional)
 *   quantum_influence: Quantum influence value (default: 0.7)
 *   max_length: Maximum response length (default: 1024)
 *   enable_thinking: Whether to enable thinking mode (default: true)
 *   conversation_history: Optional list of previous messages
 *
 * Outputs:
 *   query: Original query (for use in memory creation, etc.)
 *   response: Generated response text
 *   result: Full LLMGenerationResult dict
 *   tokens_used: Number of tokens used
 */
import { BaseNode, ExecutionContext } from "../../nodeBase";
import { InferenceClient } from "./inferenceClient";
import { getLogger } from "../../../../utils/logger";

const logger = getLogger("inferenceNode");

export class InferenceNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false) {
      logger.info(
        `InferenceNode ${this.nodeId}: trigger=false (insufficient funds), skipping API call`
      );
      return {
        query: "",
        response: '{"actions":[]}',
        result: { response: '{"actions":[]}', tokensUsed: 0 },
        tokens_used: 0,
      };
    }

    // Resolve inputs – matching Python's input names exactly
    const model = this.getInputValue("model", context) as
      | InferenceClient
      | undefined;
    const systemPrompt = this.getInputValue("system_prompt", context, "") as string;
    const query = this.getInputValue("query", context, "") as string;
    const contextDict = this.getInputValue("context", context, undefined);
    const quantumInfluence = this.getInputValue("quantum_influence", context,
      this.metadata.quantum_influence ?? 0.7
    ) as number;
    const maxLength = this.getInputValue("max_length", context,
      this.metadata.max_length ?? 1024
    ) as number;
    const enableThinkingRaw = this.getInputValue("enable_thinking", context,
      this.metadata.enable_thinking ?? true
    );
    let enableThinking: boolean;
    if (typeof enableThinkingRaw === "string") {
      enableThinking = enableThinkingRaw.toLowerCase() === "true";
    } else {
      enableThinking = Boolean(enableThinkingRaw);
    }
    let conversationHistory = this.getInputValue(
      "conversation_history", context, null
    ) as Array<Record<string, string>> | null;

    // Capture original system_prompt before context merging
    const originalSystemPrompt = systemPrompt;

    // Merge context into system prompt (mirrors Python logic)
    let mergedSystemPrompt = systemPrompt;
    if (contextDict) {
      if (typeof contextDict === "object" && !Array.isArray(contextDict)) {
        const ctxObj = contextDict as Record<string, unknown>;
        const contextMessages = ctxObj.messages as Array<Record<string, string>> | undefined;
        const contextMemories = ctxObj.memories as string | undefined;

        // Merge memories into system prompt
        if (contextMemories) {
          mergedSystemPrompt = mergedSystemPrompt
            ? `${mergedSystemPrompt}\n\n${contextMemories}`
            : contextMemories;
        }

        // Use context messages as conversation_history if not provided separately
        if (!conversationHistory && contextMessages) {
          conversationHistory = contextMessages;
        }
      } else if (typeof contextDict === "string" && (contextDict as string).trim()) {
        // Context from TelegramMemorySelector is a formatted string
        logger.debug(
          `InferenceNode ${this.nodeId}: Appending string context (${(contextDict as string).length} chars) to system prompt`
        );
        mergedSystemPrompt = mergedSystemPrompt
          ? `${mergedSystemPrompt}\n\n--- Chat History ---\n${contextDict}`
          : contextDict as string;
      }
    }

    // Handle missing/empty query gracefully (like Python)
    if (!query || !String(query).trim()) {
      logger.info(
        `InferenceNode ${this.nodeId}: No query provided (likely gated by binary_intent), returning empty response`
      );
      return {
        query: typeof query === "string" ? query : "",
        response: "",
        result: null,
        tokens_used: 0,
      };
    }

    // Model is required (may be InferenceClient or { model: InferenceClient, agent_id?: string })
    const client = model && typeof model === "object" && "model" in model
      ? (model as { model: InferenceClient }).model
      : (model as InferenceClient | undefined);
    const agentId = model && typeof model === "object" && "agent_id" in model
      ? (model as { agent_id?: string }).agent_id
      : undefined;
    if (!client) {
      throw new Error(
        `InferenceNode ${this.nodeId}: 'model' input is required. ` +
          "Connect an InferenceConfigNode upstream."
      );
    }

    // System prompt is optional (e.g. when using a router agent that has its own)
    const queryPreview = query.length > 100 ? query.slice(0, 100) + "..." : query;
    logger.info(
      `InferenceNode ${this.nodeId}: query="${queryPreview}", system_prompt=${mergedSystemPrompt.length} chars, thinking=${enableThinking}`
    );

    // DEBUG: full untruncated data (visible when OBELISK_CORE_DEBUG=true)
    logger.debug(`InferenceNode ${this.nodeId} === FULL QUERY ===\n${query}`);
    logger.debug(`InferenceNode ${this.nodeId} === FULL SYSTEM PROMPT (${mergedSystemPrompt.length} chars) ===\n${mergedSystemPrompt}`);
    if (conversationHistory && conversationHistory.length > 0) {
      logger.debug(`InferenceNode ${this.nodeId} === CONVERSATION HISTORY (${conversationHistory.length} messages) ===\n${JSON.stringify(conversationHistory, null, 2)}`);
    }

    // Generate response using the model (matches Python signature)
    const result = await client.generate(
      String(query),
      String(mergedSystemPrompt),
      Number(quantumInfluence),
      Number(maxLength),
      conversationHistory,
      enableThinking,
      agentId
    );

    const responseText = result.response ?? "";
    logger.info(
      `InferenceNode ${this.nodeId}: response=${responseText.length} chars, tokens=${result.tokensUsed ?? 0}`
    );

    // Output format matches Python exactly
    return {
      query: String(query),
      response: responseText,
      result,
      tokens_used: result.tokensUsed ?? 0,
    };
  }
}
