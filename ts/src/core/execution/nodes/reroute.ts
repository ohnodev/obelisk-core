/**
 * RerouteNode – a simple pass-through node used purely for visual
 * wire-routing in the workflow graph.
 *
 * Inputs:
 *   (unnamed): any value
 *
 * Outputs:
 *   (unnamed): the same value, forwarded as-is
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("reroute");

export class RerouteNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    // Forward every input to a same-named output.
    // The default workflow uses a single unnamed pair, but we support
    // any key that upstream might connect.
    const outputs: Record<string, unknown> = {};

    // Try all known input connection names
    for (const inputName of Object.keys(this.inputConnections)) {
      const value = this.getInputValue(inputName, context, null);
      outputs[inputName] = value;
      logger.debug(
        `[Reroute ${this.nodeId}] Forwarding input '${inputName}' → output`
      );
    }

    // If no connections matched, pass through a generic "" key
    if (Object.keys(outputs).length === 0) {
      const value = this.getInputValue("", context, null);
      outputs[""] = value;
    }

    return outputs;
  }
}
