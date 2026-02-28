import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { callBasemarket, resolveBaseUrl } from "./basemarketShared";

const logger = getLogger("basemarketCurrentRound");

export class BasemarketCurrentRoundNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, skipped: true, reason: "trigger is false" };
    }

    const baseUrl = resolveBaseUrl(this, context);
    const result = await callBasemarket(baseUrl, "/api/trade/current-round", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!result.ok) {
      logger.warn(
        `[BasemarketCurrentRound ${this.nodeId}] Failed to fetch current round: ${result.error}`
      );
      return {
        success: false,
        current_round: null,
        status: result.status,
        error: result.error ?? "Failed to fetch current round",
        response: result.data,
      };
    }

    const currentRound =
      (result.data.currentRound as number | undefined) ??
      (result.data.current_round as number | undefined) ??
      null;

    return {
      success: true,
      current_round: currentRound,
      status: result.status,
      response: result.data,
    };
  }
}
