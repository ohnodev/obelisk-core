/**
 * PolymarketLpFillOrderNode – calls polymarket-service POST /api/trading/lp/fill-order.
 * Parses request body from listener (raw_body), places limit SELL, poll-for-fill-or-revert is done by the service.
 * Outputs success, filled, orderId, error, request_id for downstream http_response and multicall stub.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString, callPolymarket, resolvePolymarketBaseUrl } from "./polymarketShared";

const logger = getLogger("polymarketLpFillOrder");

const LP_FILL_TIMEOUT_MS = 15_000;

export class PolymarketLpFillOrderNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      const rid = asString(this.getInputValue("request_id", context, ""));
      return {
        success: true,
        skipped: true,
        filled: false,
        orderId: null,
        error: null,
        request_id: rid,
        status_code: 200,
        response_body: { status: "skipped", request_id: rid },
      };
    }

    const requestId = asString(
      this.getInputValue("request_id", context, "") ?? this.metadata.request_id
    );
    const rawBody =
      asString(this.getInputValue("raw_body", context, undefined)) ??
      asString(this.getInputValue("message", context, undefined)) ??
      "";

    let body: Record<string, unknown>;
    try {
      body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      const out = {
        success: false,
        filled: false,
        orderId: null,
        error: "Invalid JSON in raw_body",
        request_id: requestId,
        status_code: 400,
        response_body: { filled: false, error: "Invalid JSON in raw_body", request_id: requestId },
      };
      return { ...out, result: out };
    }

    const tokenId = asString(body.tokenId ?? body.token_id);
    const amount = body.amount ?? body.size;
    const requestedPrice = body.requestedPrice ?? body.price;
    if (!tokenId || amount == null || (requestedPrice != null && Number(requestedPrice) <= 0)) {
      const err = "Missing or invalid required fields: tokenId, amount/size, requestedPrice";
      const out = {
        success: false,
        filled: false,
        orderId: null,
        error: err,
        request_id: requestId,
        status_code: 400,
        response_body: { filled: false, error: err, request_id: requestId },
      };
      return { ...out, result: out };
    }

    const pkFromInput = asString(this.getInputValue("private_key", context, undefined));
    const pkFromMeta = asString(
      (this as unknown as { resolveEnvVar?: (v: unknown) => unknown }).resolveEnvVar?.(
        this.metadata.private_key
      ) ?? this.metadata.private_key
    );
    const privateKey =
      pkFromInput ||
      pkFromMeta ||
      asString(body.privateKey ?? body.private_key) ||
      asString(process.env.POLYMARKET_PRIVATE_KEY) ||
      asString(process.env.SWAP_PRIVATE_KEY);

    if (!privateKey) {
      const err = "privateKey required (input, metadata, body, or env)";
      const out = {
        success: false,
        filled: false,
        orderId: null,
        error: err,
        request_id: requestId,
        status_code: 400,
        response_body: { filled: false, error: err, request_id: requestId },
      };
      return { ...out, result: out };
    }

    const baseUrl = resolvePolymarketBaseUrl(this, context);
    const payload = {
      privateKey: privateKey,
      tokenId,
      amount: Number(amount),
      size: Number(amount),
      requestedPrice: Number(requestedPrice),
      slippage: body.slippage != null ? Number(body.slippage) : undefined,
      expiryMs: body.expiryMs != null ? Number(body.expiryMs) : undefined,
    };

    try {
      const result = await callPolymarket(
        baseUrl,
        "/api/trading/lp/fill-order",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        },
        LP_FILL_TIMEOUT_MS
      );

      const filled = result.data?.filled === true;
      const orderId = (result.data?.orderId as string) ?? null;
      const errMsg = result.data?.error as string | undefined;

      const statusCode = result.ok && filled ? 200 : 408;
      const responseBody: Record<string, unknown> = result.ok && filled
        ? { status: "filled", processing: true, request_id: requestId, orderId }
        : { filled: false, error: result.ok ? (errMsg ?? "Order did not fill within expiry") : (result.error ?? errMsg), request_id: requestId };

      const out = {
        success: result.ok && filled,
        filled,
        orderId,
        error: result.ok ? (filled ? null : errMsg ?? "Order did not fill within expiry") : (result.error ?? errMsg),
        request_id: requestId,
        status_code: statusCode,
        response_body: responseBody,
      };
      if (!result.ok) {
        logger.warn(
          `[PolymarketLpFillOrder ${this.nodeId}] fill-order failed: ${result.status} ${result.error}`
        );
      }
      return { ...out, result: out };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[PolymarketLpFillOrder ${this.nodeId}] request failed: ${msg}`);
      const out = {
        success: false,
        filled: false,
        orderId: null,
        error: msg,
        request_id: requestId,
        status_code: 500,
        response_body: { filled: false, error: msg, request_id: requestId },
      };
      return { ...out, result: out };
    }
  }
}
