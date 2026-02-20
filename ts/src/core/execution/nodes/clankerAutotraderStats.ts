/**
 * ClankerAutotraderStatsNode – reads clanker_bags.json and clanker_actions.json from storage,
 * formats for dashboard consumption. Inputs: request_id, storage_instance (or clanker_storage_path).
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import type { ClankerBagState, BagHolding } from "./clankerBags";
import { resolveBagsPath, resolveActionsPath } from "./clankerStoragePath";

const logger = getLogger("clankerAutotraderStats");

const DEFAULT_ACTIONS_LIMIT = 20;

export class ClankerAutotraderStatsNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const requestId = (this.getInputValue("request_id", context, "") as string) ?? "";
    const actionsLimit = Math.min(
      100,
      Math.max(1, Number(this.getInputValue("actions_limit", context, DEFAULT_ACTIONS_LIMIT)) || DEFAULT_ACTIONS_LIMIT)
    );
    const bagsPath = resolveBagsPath(this, context);
    const actionsPath = resolveActionsPath(this, context);

    let bags: { lastUpdated: number; holdings: BagHolding[] } = { lastUpdated: 0, holdings: [] };
    if (bagsPath && fs.existsSync(bagsPath)) {
      try {
        const raw = fs.readFileSync(bagsPath, "utf-8");
        const bagState = JSON.parse(raw) as ClankerBagState;
        bags = {
          lastUpdated: bagState.lastUpdated ?? 0,
          holdings: Object.values(bagState.holdings ?? {}),
        };
      } catch (e) {
        logger.warn(`[ClankerAutotraderStats] Failed to read bags from ${abbrevPathForLog(bagsPath)}: ${e}`);
      }
    }

    let actions: Array<{ type: string; tokenAddress?: string; amount?: string; valueEth?: string; txHash?: string; timestamp?: number }> = [];
    if (actionsPath && fs.existsSync(actionsPath)) {
      try {
        const raw = fs.readFileSync(actionsPath, "utf-8");
        const data = JSON.parse(raw);
        const list = Array.isArray(data) ? data : (data?.actions ?? []);
        actions = list.slice(-actionsLimit).reverse();
      } catch (e) {
        logger.warn(`[ClankerAutotraderStats] Failed to read actions from ${abbrevPathForLog(actionsPath)}: ${e}`);
      }
    }

    const payload = { bags, actions };
    const stats = JSON.stringify(payload);

    return { stats, request_id: requestId };
  }
}
