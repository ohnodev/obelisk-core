import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString, callBasemarket, resolveBaseUrl, resolveUserAddress } from "./basemarketShared";

const logger = getLogger("basemarketBalances");

export class BasemarketBalancesNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, skipped: true, reason: "trigger is false" };
    }

    const baseUrl = resolveBaseUrl(this, context);
    const userAddress = resolveUserAddress(this, context);
    if (!userAddress) {
      return {
        success: false,
        error: "user_address is required",
        balances: {},
      };
    }

    const roundValue =
      this.getInputValue("round_id", context, undefined) ??
      this.getInputValue("current_round", context, undefined) ??
      this.metadata.round_id;
    const roundId = asString(roundValue);
    if (!roundId) {
      return {
        success: false,
        error: "round_id (or current_round input) is required",
        balances: {},
      };
    }

    const path = `/v1/trade/balances?user=${encodeURIComponent(userAddress)}&roundId=${encodeURIComponent(roundId)}`;
    const result = await callBasemarket(baseUrl, path, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-user-address": userAddress,
      },
    });

    if (!result.ok) {
      logger.warn(
        `[BasemarketBalances ${this.nodeId}] Failed to fetch balances: ${result.error}`
      );
      return {
        success: false,
        status: result.status,
        error: result.error ?? "Failed to fetch balances",
        balances: {},
        response: result.data,
      };
    }

    return {
      success: true,
      user_address: userAddress,
      round_id: roundId,
      balances: result.data,
      status: result.status,
      response: result.data,
    };
  }
}
