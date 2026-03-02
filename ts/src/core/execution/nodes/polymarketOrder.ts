import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString, callPolymarket, isValidHexPrivateKey, resolvePolymarketBaseUrl } from "./polymarketShared";
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
      const skipReason =
        (this.getInputValue("reason", context, undefined) as string | undefined) ?? "no signal (skip)";
      const sniperContext = this.getInputValue("sniper_context", context, undefined);
      const out: Record<string, unknown> = { success: true, skipped: true, reason: skipReason };
      if (sniperContext && typeof sniperContext === "object") {
        out.sniper_context = sniperContext;
      }
      return { ...out, result: out };
    }

    const baseUrl = resolvePolymarketBaseUrl(this, context);
    const tokenId = asString(
      this.getInputValue("token_id", context, undefined) ??
        this.resolveEnvVar(this.metadata.token_id) ??
        this.metadata.token_id
    );
    const price = toNum(
      this.getInputValue("price", context, undefined) ??
        this.resolveEnvVar(this.metadata.price) ??
        this.metadata.price
    );
    const size = toNum(
      this.getInputValue("size", context, undefined) ??
        this.resolveEnvVar(this.metadata.size) ??
        this.metadata.size
    );
    const outcome = asString(
      this.getInputValue("outcome", context, undefined) ??
        this.resolveEnvVar(this.metadata.outcome) ??
        this.metadata.outcome ??
        "YES"
    );
    const useMarketOrder =
      this.getInputValue("use_market_order", context, false) === true ||
      String(
        this.getInputValue("use_market_order", context, undefined) ??
          this.resolveEnvVar(this.metadata.use_market_order) ??
          this.metadata.use_market_order
      )
        .trim()
        .toLowerCase() === "true";

    const userAddr = asString(this.getInputValue("user_address", context, undefined));
    const walletAddr = asString(this.getInputValue("wallet_address", context, undefined));
    const walletAddress = userAddr || walletAddr || "";
    const pkFromInput = asString(this.getInputValue("private_key", context, undefined));
    const pkFromMeta = asString(this.resolveEnvVar(this.metadata.private_key) ?? this.metadata.private_key);
    const privateKey =
      pkFromInput || pkFromMeta || asString(process.env.POLYMARKET_PRIVATE_KEY) || asString(process.env.SWAP_PRIVATE_KEY) || "";

    const resolvedAddress =
      walletAddress ||
      (privateKey && isValidHexPrivateKey(privateKey)
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
    if (!useMarketOrder && (price == null || !Number.isFinite(price) || price <= 0)) {
      const out = {
        success: false,
        error: "price must be > 0 for limit orders",
        order_id: null,
      };
      return { ...out, result: out };
    }

    const floorSize = Math.floor(size);
    const clampedSize = Math.max(5, floorSize);
    if (floorSize < 5) {
      logger.warn(
        `[PolymarketOrder ${this.nodeId}] size clamped: requested=${floorSize} -> ${clampedSize} (min 5) tokenId=${tokenId} outcome=${outcome}`
      );
    }

    const body: Record<string, unknown> = {
      tokenId,
      side: "BUY",
      outcome: outcome.toUpperCase(),
      size: clampedSize,
      isMarket: useMarketOrder,
    };
    if (!useMarketOrder) {
      body.price = price;
    }
    // privateKey passed in body by design; polymarket-service requires it per-request (no env fallback)
    if (privateKey && isValidHexPrivateKey(privateKey)) {
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

    if (orderId == null || orderId === "") {
      const out = {
        success: false,
        order_id: null,
        status: result.status,
        error: "Order response missing orderId",
        response: result.data,
      };
      return { ...out, result: out };
    }

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
