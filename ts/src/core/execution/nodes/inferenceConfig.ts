/**
 * InferenceConfigNode – creates an InferenceClient and outputs it as 'model'.
 * Mirrors Python src/core/execution/nodes/inference_config.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { InferenceClient } from "./inference/inferenceClient";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("inferenceConfig");

// Client cache (shared across all InferenceConfigNode instances)
const clientCache: Record<string, InferenceClient> = {};

export class InferenceConfigNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const endpointUrl =
      (this.metadata.endpoint_url as string) || "";

    // Workflow metadata endpoint_url always wins when set;
    // fall back to env var / hardcoded default only when absent.
    const resolvedUrl = endpointUrl || InferenceClient.DEFAULT_ENDPOINT;

    // Resolve API key from metadata override or environment default
    const apiKey =
      (this.metadata.api_key as string) ?? InferenceClient.DEFAULT_API_KEY;

    // Cache key includes both endpoint and API key so different
    // credentials produce distinct client instances.
    const cacheKey = `${resolvedUrl}::${apiKey}`;
    if (!clientCache[cacheKey]) {
      logger.info(
        `InferenceConfigNode ${this.nodeId}: creating client → ${resolvedUrl}${apiKey ? " (with API key)" : ""}`
      );
      clientCache[cacheKey] = new InferenceClient({
        endpointUrl: resolvedUrl,
        apiKey,
      });
    } else {
      logger.debug(
        `InferenceConfigNode ${this.nodeId}: using cached client → ${resolvedUrl}`
      );
    }

    return { model: clientCache[cacheKey] };
  }
}
