import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { callPolymarket, resolvePolymarketBaseUrl } from "./polymarketShared";

const logger = getLogger("polymarketSnapshot");

export class PolymarketSnapshotNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, skipped: true, reason: "trigger is false" };
    }

    const baseUrl = resolvePolymarketBaseUrl(this, context);
    const result = await callPolymarket(baseUrl, "/api/market/snapshot", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!result.ok) {
      logger.warn(
        `[PolymarketSnapshot ${this.nodeId}] Failed to fetch snapshot: ${result.error}`
      );
      return {
        success: false,
        snapshot: null,
        status: result.status,
        error: result.error ?? "Failed to fetch snapshot",
        response: result.data,
      };
    }

    const snapshot = result.data as Record<string, unknown>;
    return {
      success: true,
      snapshot,
      status: result.status,
      response: result.data,
    };
  }
}
