/**
 * BinaryIntentNode – uses the LLM to decide yes/no on an intent.
 * Mirrors Python src/core/execution/nodes/binary_intent.py
 *
 * Inputs:
 *   message: The message to evaluate (required)
 *   intent_criteria: What to detect/check for (optional, can come from widget)
 *   context: Additional context for the decision (optional)
 *   model: InferenceClient (required)
 *
 * Outputs:
 *   result: Boolean true/false
 *   message: Original message if result is true, null if false
 *   confidence: "high", "medium", or "low"
 *   reasoning: Brief explanation of the decision
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { InferenceClient } from "./inference/inferenceClient";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("binaryIntent");

// System prompt template – matches Python exactly
const SYSTEM_PROMPT = `You are an intent classifier. Your job is to analyze text and determine if it matches the specified criteria.

You MUST respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "result": true,
  "confidence": "high",
  "reasoning": "Brief explanation"
}

Rules:
- "result" must be true or false (boolean, not string)
- "confidence" must be exactly one of: "high", "medium", "low"
- "reasoning" should be 1 brief sentence explaining why

Respond with JSON only. Start with { and end with }.`;

export class BinaryIntentNode extends BaseNode {
  private defaultCriteria: string;

  constructor(nodeId: string, nodeData: Record<string, unknown> | import("../../types").NodeData) {
    super(nodeId, nodeData as import("../../types").NodeData);
    this.defaultCriteria = (this.metadata.intent_criteria as string) ?? "";
  }

  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const model = this.getInputValue("model", context) as
      | InferenceClient
      | undefined;
    const message = this.getInputValue("message", context, "") as string;
    const intentCriteriaInput = this.getInputValue(
      "intent_criteria",
      context,
      ""
    ) as string;
    const additionalContext = this.getInputValue("context", context, "") as string;

    // Use input criteria if provided, otherwise use widget/property value
    const intentCriteria =
      intentCriteriaInput || (this.metadata.intent_criteria as string) || "";

    if (!message || !message.trim()) {
      logger.warning("[BinaryIntent] No message provided");
      return {
        result: false,
        message: null,
        confidence: "low",
        reasoning: "No message provided to analyze",
      };
    }

    if (!intentCriteria) {
      logger.warning("[BinaryIntent] No intent criteria provided");
      return {
        result: false,
        message: null,
        confidence: "low",
        reasoning: "No intent criteria specified",
      };
    }

    if (!model) {
      throw new Error(
        `BinaryIntentNode ${this.nodeId}: 'model' input is required`
      );
    }

    // Build the query (matches Python format)
    const queryParts = [`CRITERIA TO CHECK:\n${intentCriteria}`];

    if (additionalContext) {
      queryParts.push(`\nADDITIONAL CONTEXT:\n${additionalContext}`);
    }

    queryParts.push(`\nMESSAGE TO ANALYZE:\n${message}`);
    queryParts.push("\nRespond with JSON only:");

    const query = queryParts.join("\n");

    logger.debug(
      `BinaryIntentNode ${this.nodeId}: classifying intent for message (${message.length} chars)`
    );

    // Generate classification (matches Python signature)
    const genResult = await model.generate(
      query,
      SYSTEM_PROMPT,
      0.1, // Low quantum_influence for consistent classification
      200, // Short response needed
      null, // No conversation history
      false // Fast, direct response (no thinking)
    );

    if (genResult.error || !genResult.response) {
      logger.error(
        `BinaryIntentNode ${this.nodeId}: generation failed – ${genResult.error}`
      );
      return {
        result: false,
        message: null,
        confidence: "low",
        reasoning: genResult.error ?? "Generation failed",
      };
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
        intentResult = ["true", "1", "yes", "y"].includes(
          raw.trim().toLowerCase()
        );
      } else if (typeof raw === "number") {
        intentResult = raw !== 0;
      } else {
        intentResult = false;
      }

      let confidence = (parsed.confidence as string) ?? "low";
      if (!["high", "medium", "low"].includes(confidence)) {
        confidence = "medium";
      }
      const reasoning = (parsed.reasoning as string) ?? "No reasoning provided";

      logger.info(
        `[BinaryIntent] Result: ${intentResult}, Confidence: ${confidence}, Reasoning: ${reasoning}`
      );

      return {
        result: intentResult,
        message: intentResult ? message : null,
        confidence,
        reasoning,
      };
    } catch (e) {
      logger.error(
        `BinaryIntentNode ${this.nodeId}: failed to parse response – ${e}`
      );
      return {
        result: false,
        message: null,
        confidence: "low",
        reasoning: "Failed to parse classification response",
      };
    }
  }
}
