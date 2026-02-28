import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString, callBasemarket, resolveBaseUrl, resolveUserAddress } from "./basemarketShared";

const logger = getLogger("basemarketTradeAction");

const ACTION_ENDPOINTS: Record<string, string> = {
  "mint-complete-set": "/api/trade/mint-complete-set",
  sell: "/api/trade/sell",
  "open-sell": "/api/trade/sell",
  open_sell: "/api/trade/sell",
  "open-buy": "/api/trade/sell",
  open_buy: "/api/trade/sell",
  close: "/api/trade/close",
  "close-sell": "/api/trade/close",
  close_sell: "/api/trade/close",
  "close-buy": "/api/trade/close",
  close_buy: "/api/trade/close",
  refund: "/api/trade/refund",
  redeem: "/api/trade/redeem",
};

function normalizeAction(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export class BasemarketTradeActionNode extends BaseNode {
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
      };
    }

    const actionRaw =
      this.getInputValue("action", context, undefined) ?? this.metadata.action ?? "mint-complete-set";
    const action = normalizeAction(asString(actionRaw));
    const endpoint = ACTION_ENDPOINTS[action];
    if (!endpoint) {
      return {
        success: false,
        error: `Unsupported action '${action}'. Expected one of: ${Object.keys(ACTION_ENDPOINTS).join(", ")}`,
      };
    }

    const payloadInput = this.getInputValue("payload", context, undefined);
    const metadataPayload = this.metadata.payload;
    const payload = {
      ...parsePayload(metadataPayload),
      ...parsePayload(payloadInput),
    };

    const roundId = this.getInputValue("round_id", context, undefined);
    const currentRound = this.getInputValue("current_round", context, undefined);
    const orderId = this.getInputValue("order_id", context, undefined);
    const outcome = this.getInputValue("outcome", context, undefined);
    const amount = this.getInputValue("amount", context, undefined);
    const price = this.getInputValue("price", context, undefined);
    const signature = this.getInputValue("signature", context, undefined);

    if (roundId !== undefined && roundId !== null && payload.roundId === undefined) payload.roundId = roundId;
    if (currentRound !== undefined && currentRound !== null && payload.roundId === undefined) payload.roundId = currentRound;
    if (orderId !== undefined && orderId !== null && payload.orderId === undefined) payload.orderId = orderId;
    if (outcome !== undefined && outcome !== null && payload.outcome === undefined) payload.outcome = outcome;
    if (amount !== undefined && amount !== null && payload.amount === undefined) payload.amount = amount;
    if (price !== undefined && price !== null && payload.price === undefined) payload.price = price;
    if (signature !== undefined && signature !== null && payload.signature === undefined) payload.signature = signature;

    // Normalize high-level action aliases into explicit order side hints.
    if ((action === "open_sell" || action === "open-sell") && payload.isBuyOrder === undefined) {
      payload.isBuyOrder = false;
    }
    if ((action === "open_buy" || action === "open-buy") && payload.isBuyOrder === undefined) {
      payload.isBuyOrder = true;
    }
    if ((action === "close_sell" || action === "close-sell") && payload.isBuyOrder === undefined) {
      payload.isBuyOrder = false;
    }
    if ((action === "close_buy" || action === "close-buy") && payload.isBuyOrder === undefined) {
      payload.isBuyOrder = true;
    }

    const result = await callBasemarket(baseUrl, endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-user-address": userAddress,
      },
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      logger.warn(
        `[BasemarketTradeAction ${this.nodeId}] ${action} failed (${result.status}): ${result.error}`
      );
      return {
        success: false,
        action,
        endpoint,
        status: result.status,
        error: result.error ?? `Failed ${action}`,
        response: result.data,
      };
    }

    const txHash = asString(result.data.txHash ?? result.data.tx_hash ?? result.data.hash);
    const orderIdOut = result.data.orderId ?? result.data.order_id ?? null;

    return {
      success: true,
      action,
      endpoint,
      status: result.status,
      tx_hash: txHash || null,
      order_id: orderIdOut,
      response: result.data,
    };
  }
}
