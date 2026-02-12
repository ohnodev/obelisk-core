/**
 * ClankerLaunchSummaryNode – reads Clanker state from Blockchain Config (or state_path),
 * filters to recent launches in the past 1 hour, enriches with full token stats
 * (volume 5m/15m/30m/1h, total volume, total makers, price change, etc.) and outputs
 * data formatted for the LLM.
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("clankerLaunchSummary");

const ONE_HOUR_MS = 60 * 60 * 1000;

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export class ClankerLaunchSummaryNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const windowHoursRaw = this.getInputValue("window_hours", context, undefined);
    const windowHours =
      windowHoursRaw != null && Number.isFinite(Number(windowHoursRaw))
        ? Math.max(0.1, Math.min(24, Number(windowHoursRaw)))
        : 1;
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
        logger.warn(`[ClankerLaunchSummary] Failed to read state from ${statePath}: ${e}`);
      }
    }

    const tokens = (state?.tokens as Record<string, Record<string, unknown>>) ?? {};
    const recentLaunches = Array.isArray(state?.recentLaunches)
      ? (state.recentLaunches as Record<string, unknown>[])
      : [];

    const now = Date.now();
    const cutoff = now - windowHours * ONE_HOUR_MS;
    const inWindow = recentLaunches.filter((l) => (getNum(l.launchTime) || 0) >= cutoff);
    const slice = inWindow.slice(0, limit);

    const enriched = slice.map((launch) => {
      const addr = getStr(launch.tokenAddress).toLowerCase();
      const t = tokens[addr] ?? {};
      return {
        ...launch,
        tokenAddress: launch.tokenAddress,
        name: getStr(launch.name) || getStr(t.name),
        symbol: getStr(launch.symbol) || getStr(t.symbol),
        poolId: getStr(launch.poolId) || getStr(t.poolId),
        hookAddress: getStr(launch.hookAddress) || getStr(t.hookAddress),
        feeTier: getNum(launch.feeTier) || getNum(t.feeTier),
        tickSpacing: getNum(launch.tickSpacing) ?? getNum(t.tickSpacing),
        launchTime: launch.launchTime,
        totalSwaps: getNum(t.totalSwaps),
        totalBuys: getNum(t.totalBuys),
        totalSells: getNum(t.totalSells),
        volume24h: getNum(t.volume24h),
        volume1h: getNum(t.volume1h),
        volume30m: getNum(t.volume30m),
        volume15m: getNum(t.volume15m),
        volume5m: getNum(t.volume5m),
        totalMakers: getNum(t.totalMakers),
        lastPrice: getNum(t.lastPrice),
        priceChange5m: getNum(t.priceChange5m),
        priceChange15m: getNum(t.priceChange15m),
        priceChange30m: getNum(t.priceChange30m),
        priceChange1h: getNum(t.priceChange1h),
      };
    });

    const lines = enriched.map(
      (e) =>
        `- ${e.symbol || e.tokenAddress} (${e.tokenAddress}): vol24h=$${getNum(e.volume24h).toFixed(0)} vol1h=$${getNum(e.volume1h).toFixed(0)} vol5m=$${getNum(e.volume5m).toFixed(0)} makers=${getNum(e.totalMakers)} swaps=${getNum(e.totalSwaps)} priceChange1h=${getNum(e.priceChange1h)}% poolFee=${getNum(e.feeTier)} tickSpacing=${getNum(e.tickSpacing)} hook=${getStr(e.hookAddress).slice(0, 10)}...`
    );
    const summary =
      `Recent Clanker launches (past ${windowHours}h) with stats:\n` + (lines.length ? lines.join("\n") : "(none)");

    return {
      recent_launches: enriched,
      summary,
      count: enriched.length,
      text: summary,
    };
  }
}
