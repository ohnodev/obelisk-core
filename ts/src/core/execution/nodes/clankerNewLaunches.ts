/**
 * ClankerNewLaunchesNode – returns recent launch events from Clanker state (from BlockchainConfigNode or state_path).
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("clankerNewLaunches");

export class ClankerNewLaunchesNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const limitRaw = this.getInputValue("limit", context, undefined);
    const limit =
      limitRaw != null && Number.isFinite(Number(limitRaw))
        ? Math.max(1, Math.min(100, Number(limitRaw)))
        : 20;

    let state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const statePath = this.getInputValue("state_path", context, undefined) as string | undefined;

    if (!state && statePath) {
      try {
        if (fs.existsSync(statePath)) {
          const raw = fs.readFileSync(statePath, "utf-8");
          state = JSON.parse(raw) as Record<string, unknown>;
        }
      } catch (e) {
        logger.warn(`[ClankerNewLaunches] Failed to read state from ${statePath}: ${e}`);
      }
    }

    const recentLaunches = Array.isArray(state?.recentLaunches)
      ? (state.recentLaunches as Record<string, unknown>[])
      : [];
    const slice = recentLaunches.slice(0, limit);

    return { recent_launches: slice, count: slice.length };
  }
}
