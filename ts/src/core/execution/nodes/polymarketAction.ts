import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString, callPolymarket, isValidHexPrivateKey, resolvePolymarketBaseUrl } from "./polymarketShared";
import { Wallet } from "ethers";

const logger = getLogger("polymarketAction");

export class PolymarketActionNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, skipped: true, reason: "trigger is false" };
    }

    const baseUrl = resolvePolymarketBaseUrl(this, context);
    const actionRaw =
      this.getInputValue("action", context, undefined) ??
      this.resolveEnvVar(this.metadata.action) ??
      this.metadata.action ??
      "status";
    const action = String(actionRaw).trim().toLowerCase().replace(/-/g, "_");

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

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (resolvedAddress) {
      headers["x-user-address"] = resolvedAddress;
    }

    if (action === "status") {
      const result = await callPolymarket(baseUrl, "/api/trading/status", {
        method: "GET",
        headers,
      });
      if (!result.ok) {
        return {
          success: false,
          action,
          status: result.status,
          error: result.error ?? "Failed to fetch status",
          response: result.data,
        };
      }
      return {
        success: true,
        action,
        response: result.data,
      };
    }

    if (action === "redeem" || action === "housekeeping" || action === "close_orders") {
      const path =
        action === "close_orders"
          ? "/api/trading/close-orders"
          : "/api/trading/housekeeping";
      const body: Record<string, unknown> = {};
      if (privateKey && isValidHexPrivateKey(privateKey)) {
        body.privateKey = privateKey;
      }
      const result = await callPolymarket(baseUrl, path, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        return {
          success: false,
          action,
          status: result.status,
          error: result.error ?? `Failed ${action}`,
          response: result.data,
        };
      }
      return {
        success: true,
        action,
        response: result.data,
      };
    }

    return {
      success: false,
      action,
      error: `Unsupported action: ${action}. Use status, redeem, housekeeping, or close_orders.`,
    };
  }
}
