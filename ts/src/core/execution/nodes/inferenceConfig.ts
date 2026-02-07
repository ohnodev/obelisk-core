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
    const useDefault =
      (this.metadata.use_default as boolean) ?? true;

    // Resolve endpoint
    let resolvedUrl: string;
    if (useDefault || !endpointUrl) {
      resolvedUrl = InferenceClient.DEFAULT_ENDPOINT;
    } else {
      resolvedUrl = endpointUrl;
    }

    // Cache to reuse the same client for the same endpoint
    if (!clientCache[resolvedUrl]) {
      logger.info(
        `InferenceConfigNode ${this.nodeId}: creating client → ${resolvedUrl}`
      );
      clientCache[resolvedUrl] = new InferenceClient({
        endpointUrl: resolvedUrl,
      });
    } else {
      logger.debug(
        `InferenceConfigNode ${this.nodeId}: using cached client → ${resolvedUrl}`
      );
    }

    return { model: clientCache[resolvedUrl] };
  }
}
