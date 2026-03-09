/**
 * MulticallStubNode – placeholder for future Base-chain multicall that fills the user's order via Basemarket.
 * No-op for now: logs that multicall would run and outputs success.
 * Replace with real multicall invocation when the contract is ready.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString } from "./polymarketShared";

const logger = getLogger("multicallStub");

export class MulticallStubNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: false, skipped: true };
    }

    const orderId = asString(this.getInputValue("order_id", context, undefined));
    const requestId = asString(this.getInputValue("request_id", context, undefined));

    logger.info(
      `[MulticallStub ${this.nodeId}] Multicall would run here (orderId=${orderId ?? "n/a"} request_id=${requestId ?? "n/a"})`
    );

    return {
      success: true,
      order_id: orderId ?? null,
      request_id: requestId ?? null,
    };
  }
}
