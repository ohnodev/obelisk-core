/**
 * UpdateBagsOnSellNode – after a successful Clanker sell, remove that token from bag state.
 *
 * Inputs: sell_result (from Clanker Sell), storage_instance (or clanker_storage_path)
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import type { ClankerBagState } from "./clankerBags";
import { resolveBagsPath } from "./clankerStoragePath";

const logger = getLogger("updateBagsOnSell");

export class UpdateBagsOnSellNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const sellResult = this.getInputValue("sell_result", context, undefined) as Record<string, unknown> | undefined;
    const resolvedBagPath = resolveBagsPath(this, context);
    if (!resolvedBagPath) return { success: false, error: "storage_instance (or clanker_storage_path) required" };

    // Remove holding on successful sell OR when wallet has zero token balance
    if ((!sellResult?.success && !sellResult?.zeroBalance) || !sellResult?.token_address) {
      return { success: true };
    }

    const tokenAddress = String(sellResult.token_address).toLowerCase();
    if (sellResult.zeroBalance) {
      logger.info(`[UpdateBagsOnSell] Removing ${tokenAddress} — zero on-chain balance`);
    }
    // Load existing bags from storage first; only start fresh if file missing
    let bagState: ClankerBagState = { lastUpdated: 0, holdings: {} };
    if (fs.existsSync(resolvedBagPath)) {
      try {
        const raw = fs.readFileSync(resolvedBagPath, "utf-8");
        bagState = JSON.parse(raw) as ClankerBagState;
      } catch (_) {
        return { success: false, error: "Failed to load bag state from storage" };
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
