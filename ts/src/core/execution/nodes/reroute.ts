/**
 * RerouteNode – a simple pass-through node used purely for visual
 * wire-routing in the workflow graph.
 *
 * Inputs:
 *   in: any value
 *
 * Outputs:
 *   out: the same value, forwarded as-is
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("reroute");

export class RerouteNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const value = this.getInputValue("in", context, null);
    logger.debug(
      `[Reroute ${this.nodeId}] Forwarding value: ${value !== null ? "present" : "null"}`
    );

    return { out: value };
  }
}
