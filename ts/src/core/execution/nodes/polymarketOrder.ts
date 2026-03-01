import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString, callPolymarket, resolvePolymarketBaseUrl } from "./polymarketShared";
import { Wallet } from "ethers";

const logger = getLogger("polymarketOrder");

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class PolymarketOrderNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      const out = { success: true, skipped: true, reason: "trigger is false" };
      return { ...out, result: out };
    }

    const skip = this.getInputValue("skip", context, false);
    if (skip === true || String(skip).trim().toLowerCase() === "true") {
      const out = { success: true, skipped: true, reason: "no signal (skip)" };
      return { ...out, result: out };
    }

    const baseUrl = resolvePolymarketBaseUrl(this, context);
    const tokenId = asString(
      this.getInputValue("token_id", context, undefined) ?? this.metadata.token_id
    );
    const price = toNum(this.getInputValue("price", context, undefined) ?? this.metadata.price);
    const size = toNum(this.getInputValue("size", context, undefined) ?? this.metadata.size);
    const outcome = asString(
      this.getInputValue("outcome", context, undefined) ?? this.metadata.outcome ?? "YES"
    );
    const useMarketOrder =
      this.getInputValue("use_market_order", context, false) === true ||
      String(this.getInputValue("use_market_order", context, this.metadata.use_market_order))
        .trim()
        .toLowerCase() === "true";

    const walletAddress =
      (this.getInputValue("user_address", context, undefined) as string) ??
      (this.getInputValue("wallet_address", context, undefined) as string) ??
      "";
    const privateKey =
      (this.getInputValue("private_key", context, undefined) as string) ??
      this.resolveEnvVar(this.metadata.private_key) ??
      (typeof this.metadata.private_key === "string" ? this.metadata.private_key : undefined) ??
      process.env.POLYMARKET_PRIVATE_KEY ??
      process.env.SWAP_PRIVATE_KEY ??
      "";

    const resolvedAddress =
      walletAddress ||
      (privateKey && privateKey.length >= 20
        ? (() => {
            try {
              return new Wallet(privateKey).address;
            } catch {
              return "";
            }
          })()
        : "");

    if (!tokenId || size <= 0) {
      const out = { success: false, error: "token_id and size are required", order_id: null };
      return { ...out, result: out };
    }

    const body: Record<string, unknown> = {
      tokenId,
      side: "BUY",
      outcome: outcome.toUpperCase(),
      size: Math.max(5, Math.floor(size)),
      isMarket: useMarketOrder,
    };
    if (!useMarketOrder) {
      body.price = price;
    }
    if (privateKey && privateKey.length >= 20) {
      body.privateKey = privateKey;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (resolvedAddress) {
      headers["x-user-address"] = resolvedAddress;
    }

    const result = await callPolymarket(baseUrl, "/api/trading/order", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!result.ok) {
      logger.warn(
        `[PolymarketOrder ${this.nodeId}] Order failed: ${result.error}`
      );
      const out = {
        success: false,
        order_id: null,
        status: result.status,
        error: result.error ?? "Order failed",
        response: result.data,
      };
      return { ...out, result: out };
    }

    const orderId =
      (result.data.orderId as string) ??
      (result.data.order_id as string) ??
      (result.data.id as string) ??
      null;

    const out = {
      success: true,
      skipped: false,
      order_id: orderId,
      status: result.status,
      response: result.data,
    };
    return { ...out, result: out };
  }
}
