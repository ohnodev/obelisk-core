/**
 * TelegramMemoryCreatorNode – saves Telegram interactions and creates
 * conversation summaries via the LLM.
 * Mirrors Python src/core/execution/nodes/telegram_memory_creator.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { InferenceClient } from "./inference/inferenceClient";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("telegramMemoryCreator");

export class TelegramMemoryCreatorNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const storage = this.getInputValue(
      "storage_instance",
      context,
      undefined
    ) as StorageInterface | undefined;
    const model = this.getInputValue("model", context, undefined) as
      | InferenceClient
      | undefined;
    const message = this.getInputValue("message", context, "") as string;
    const response = this.getInputValue("response", context, "") as string;
    const userId = this.getInputValue(
      "user_id",
      context,
      "telegram_user"
    ) as string;

    if (!storage) {
      throw new Error(
        `TelegramMemoryCreatorNode ${this.nodeId}: 'storage_instance' is required`
      );
    }

    if (!message && !response) {
      return { saved: false, interaction_id: null, summary: null };
    }

    // Save interaction
    const interactionId = await storage.saveInteraction({
      userId,
      query: message,
      response,
    });

    // Log the activity
    await storage.createActivityLog("telegram_message", message, {
      user_id: userId,
      interaction_id: interactionId,
      response_length: response.length,
    });

    // Create summary if we have a model
    let summary: string | null = null;
    if (model && message && response) {
      try {
        const prompt = [
          "Summarize this Telegram conversation exchange in one sentence.",
          "",
          `User: ${message.slice(0, 500)}`,
          `Bot: ${response.slice(0, 500)}`,
          "",
          'Respond with JSON: {"summary": "..."}',
          "JSON:",
        ].join("\n");

        const result = await model.generate(prompt, {
          enableThinking: false,
          maxLength: 200,
        });

        if (result.response) {
          const parsed = extractJsonFromLlmResponse(
            result.response,
            "telegram_summary"
          );
          summary = (parsed.summary as string) ?? null;
          if (summary) {
            await storage.createActivityLog("telegram_summary", summary, {
              user_id: userId,
              interaction_id: interactionId,
            });
          }
        }
      } catch (err) {
        logger.warn(
          `TelegramMemoryCreatorNode ${this.nodeId}: summary failed – ${err}`
        );
      }
    }

    logger.debug(
      `TelegramMemoryCreatorNode ${this.nodeId}: saved interaction ${interactionId}`
    );

    return { saved: true, interaction_id: interactionId, summary };
  }
}
