/**
 * MemoryCreatorNode – saves the current interaction (query + response) to storage
 * and optionally creates a summary via the LLM.
 * Mirrors Python src/core/execution/nodes/memory_creator.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { InferenceClient } from "./inference/inferenceClient";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("memoryCreator");

export class MemoryCreatorNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const storage = this.getInputValue(
      "storage_instance",
      context,
      undefined
    ) as StorageInterface | undefined;
    const model = this.getInputValue("model", context, undefined) as
      | InferenceClient
      | undefined;
    const userQuery = this.getInputValue("user_query", context, "") as string;
    const response = this.getInputValue("response", context, "") as string;
    const userId = this.getInputValue(
      "user_id",
      context,
      "default_user"
    ) as string;

    if (!storage) {
      throw new Error(
        `MemoryCreatorNode ${this.nodeId}: 'storage_instance' input is required.`
      );
    }

    if (!userQuery && !response) {
      logger.debug(
        `MemoryCreatorNode ${this.nodeId}: no query or response to save`
      );
      return { saved: false, interaction_id: null };
    }

    // Save interaction to storage
    const interactionId = await storage.saveInteraction({
      userId,
      query: userQuery,
      response,
    });

    logger.debug(
      `MemoryCreatorNode ${this.nodeId}: saved interaction ${interactionId}`
    );

    // Optionally create a summary
    let summary: string | null = null;
    const shouldSummarize =
      (this.metadata.create_summary as boolean) ?? false;

    if (shouldSummarize && model && userQuery && response) {
      try {
        summary = await this.createSummary(model, userQuery, response);
        if (summary) {
          await storage.createActivityLog("conversation_summary", summary, {
            user_id: userId,
            interaction_id: interactionId,
            summary_data: { user_id: userId },
          });
        }
      } catch (err) {
        logger.warn(
          `MemoryCreatorNode ${this.nodeId}: summary creation failed – ${err}`
        );
      }
    }

    return {
      saved: true,
      interaction_id: interactionId,
      summary,
    };
  }

  private async createSummary(
    model: InferenceClient,
    query: string,
    response: string
  ): Promise<string | null> {
    const prompt = [
      "Summarize this conversation exchange in one concise sentence.",
      "Focus on the key topic and any important information.",
      "",
      `User: ${query.slice(0, 500)}`,
      `Assistant: ${response.slice(0, 500)}`,
      "",
      'Respond with JSON: {"summary": "..."}',
      "JSON:",
    ].join("\n");

    const result = await model.generate(
      prompt,
      "You are a memory extractor. Respond with JSON only.",
      0.1,  // low quantum_influence for consistency
      200,  // short response
      null, // no conversation history
      false // no thinking
    );

    if (!result.response) return null;

    try {
      const parsed = extractJsonFromLlmResponse(
        result.response,
        "summary"
      );
      return (parsed.summary as string) ?? null;
    } catch {
      return null;
    }
  }
}
