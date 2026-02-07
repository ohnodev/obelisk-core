/**
 * InferenceNode – sends a prompt to the LLM (via InferenceClient) and returns
 * the response.
 * Mirrors Python src/core/execution/nodes/inference/node.py
 */
import { BaseNode, ExecutionContext } from "../../nodeBase";
import { InferenceClient } from "./inferenceClient";
import { getLogger } from "../../../../utils/logger";

const logger = getLogger("inferenceNode");

export class InferenceNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    // Inputs
    const model = this.getInputValue("model", context) as
      | InferenceClient
      | undefined;
    const prompt = this.getInputValue("prompt", context, "") as string;
    const memoryContext = this.getInputValue(
      "memory_context",
      context,
      undefined
    );
    const enableThinking =
      (this.getInputValue("enable_thinking", context, true) as boolean) ??
      true;

    if (!model) {
      throw new Error(
        `InferenceNode ${this.nodeId}: 'model' input is required. ` +
          "Connect an InferenceConfigNode upstream."
      );
    }

    if (!prompt || !String(prompt).trim()) {
      logger.debug(
        `InferenceNode ${this.nodeId}: empty prompt, returning empty response`
      );
      return { text: "", thinking: "", raw: {} };
    }

    // Build conversation context
    let conversationContext: Record<string, unknown> | undefined;
    if (memoryContext && typeof memoryContext === "object") {
      conversationContext = memoryContext as Record<string, unknown>;
    }

    logger.debug(
      `InferenceNode ${this.nodeId}: generating (thinking=${enableThinking}, prompt_len=${prompt.length})`
    );

    const result = await model.generate(prompt, {
      enableThinking,
      conversationContext: conversationContext as any,
    });

    if (result.error) {
      logger.error(
        `InferenceNode ${this.nodeId}: generation error – ${result.error}`
      );
    }

    return {
      text: result.response,
      thinking: result.thinkingContent ?? "",
      raw: result,
    };
  }
}
