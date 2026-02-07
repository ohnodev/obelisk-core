/**
 * BinaryIntentNode – uses the LLM to decide yes/no on an intent.
 * Mirrors Python src/core/execution/nodes/binary_intent.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { InferenceClient } from "./inference/inferenceClient";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("binaryIntent");

export class BinaryIntentNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const model = this.getInputValue("model", context) as
      | InferenceClient
      | undefined;
    const message = this.getInputValue("message", context, "") as string;
    const intentDescription = this.getInputValue(
      "intent_description",
      context,
      ""
    ) as string;

    if (!model) {
      throw new Error(
        `BinaryIntentNode ${this.nodeId}: 'model' input is required`
      );
    }

    if (!message || !message.trim()) {
      logger.debug(
        `BinaryIntentNode ${this.nodeId}: empty message, returning false`
      );
      return { result: false, message: null, reasoning: "No message provided" };
    }

    const description =
      intentDescription ||
      (this.metadata.intent_description as string) ||
      "Does this message require a response?";

    const prompt = [
      "You are an intent classifier. Analyze the following message and determine if it matches the described intent.",
      "",
      `Intent: ${description}`,
      `Message: ${message}`,
      "",
      "Respond with ONLY a JSON object:",
      '{"result": true/false, "reasoning": "brief explanation"}',
      "",
      "JSON:",
    ].join("\n");

    logger.debug(
      `BinaryIntentNode ${this.nodeId}: classifying intent for message (${message.length} chars)`
    );

    const genResult = await model.generate(prompt, {
      enableThinking: false,
      maxLength: 200,
    });

    if (genResult.error || !genResult.response) {
      logger.error(
        `BinaryIntentNode ${this.nodeId}: generation failed – ${genResult.error}`
      );
      return { result: false, message: null, reasoning: genResult.error ?? "Generation failed" };
    }

    try {
      const parsed = extractJsonFromLlmResponse(
        genResult.response,
        "binary_intent"
      );
      let intentResult: boolean;
      const raw = parsed.result;
      if (typeof raw === "boolean") {
        intentResult = raw;
      } else if (typeof raw === "string") {
        intentResult = ["true", "1"].includes(raw.trim().toLowerCase());
      } else if (typeof raw === "number") {
        intentResult = raw !== 0;
      } else {
        intentResult = false;
      }
      const reasoning = (parsed.reasoning as string) ?? "";

      logger.debug(
        `BinaryIntentNode ${this.nodeId}: result=${intentResult} reasoning="${reasoning}"`
      );

      return {
        result: intentResult,
        message: intentResult ? message : null,
        reasoning,
      };
    } catch (e) {
      logger.error(
        `BinaryIntentNode ${this.nodeId}: failed to parse response – ${e}`
      );
      return { result: false, message: null, reasoning: "Failed to parse LLM response" };
    }
  }
}
