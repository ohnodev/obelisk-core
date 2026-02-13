/**
 * UpdateBagsOnSellNode – after a successful Clanker sell, remove that token from bag state.
 *
 * Inputs: sell_result (from Clanker Sell), bag_state_path or state_path
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import type { ClankerBagState } from "./clankerBags";

const logger = getLogger("updateBagsOnSell");

export class UpdateBagsOnSellNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const sellResult = this.getInputValue("sell_result", context, undefined) as Record<string, unknown> | undefined;
    const statePath = (this.getInputValue("state_path", context, undefined) as string) ?? "";
    const bagStatePath = (this.getInputValue("bag_state_path", context, undefined) as string) ?? "";

    const resolvedBagPath = bagStatePath || (statePath ? path.join(path.dirname(statePath), "clanker_bags.json") : "");
    if (!resolvedBagPath) return { success: false, error: "bag_state_path or state_path required" };

    if (!sellResult?.success || !sellResult?.token_address) {
      return { success: true };
    }

    const tokenAddress = String(sellResult.token_address).toLowerCase();
    let bagState: ClankerBagState = { lastUpdated: 0, holdings: {} };
    if (fs.existsSync(resolvedBagPath)) {
      try {
        const raw = fs.readFileSync(resolvedBagPath, "utf-8");
        bagState = JSON.parse(raw) as ClankerBagState;
      } catch (_) {
        return { success: false, error: "Failed to read bag state" };
      }
    }
    if (!bagState.holdings) bagState.holdings = {};
    if (!(tokenAddress in bagState.holdings)) return { success: true };
    delete bagState.holdings[tokenAddress];
    bagState.lastUpdated = Date.now();
    try {
      fs.writeFileSync(resolvedBagPath, JSON.stringify(bagState, null, 2), "utf-8");
      logger.info(`[UpdateBagsOnSell] Removed ${tokenAddress} from bags`);
      return { success: true };
    } catch (e) {
      logger.warn(`[UpdateBagsOnSell] Failed to write: ${e}`);
      return { success: false, error: String(e) };
    }
  }
}
