import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { callBasemarket, resolveBaseUrl, resolveUserAddress } from "./basemarketShared";

const logger = getLogger("basemarketPositions");

function isTrueLike(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value ?? "").trim().toLowerCase() === "true";
}

export class BasemarketPositionsNode extends BaseNode {
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
        positions: [],
        active_sell_orders: [],
        positions_count: 0,
        error: "user_address is required",
      };
    }

    const path = `/v1/trade/positions?user=${encodeURIComponent(userAddress)}`;
    const result = await callBasemarket(baseUrl, path, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-user-address": userAddress,
      },
    });

    if (!result.ok) {
      logger.warn(
        `[BasemarketPositions ${this.nodeId}] Failed to fetch positions: ${result.error}`
      );
      return {
        success: false,
        positions: [],
        active_sell_orders: [],
        positions_count: 0,
        status: result.status,
        error: result.error ?? "Failed to fetch positions",
        response: result.data,
      };
    }

    const positions = Array.isArray(result.data.positions)
      ? result.data.positions
      : Array.isArray(result.data)
      ? result.data
      : [];

    const activeSellOrders = positions.filter((p) => {
      if (!p || typeof p !== "object") return false;
      const rec = p as Record<string, unknown>;
      const isActive = isTrueLike(rec.isActive ?? rec.is_active);
      const isBuy = isTrueLike(rec.isBuyOrder ?? rec.is_buy_order);
      return isActive && !isBuy;
    });

    return {
      success: true,
      user_address: userAddress,
      positions,
      active_sell_orders: activeSellOrders,
      positions_count: positions.length,
      status: result.status,
      response: result.data,
    };
  }
}
