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

    // Forward the "in" input to the "out" output
    const value = this.getInputValue("in", context, null);
    logger.debug(
      `[Reroute ${this.nodeId}] Forwarding value: ${value !== null ? "present" : "null"}`
    );

    return { out: value };
  }
}
