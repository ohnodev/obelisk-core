/**
 * ClankerLaunchSummaryNode – reads Clanker state from Blockchain Config (or state_path),
 * filters to recent launches in the past 1 hour, enriches with full token stats
 * (volume 5m/15m/30m/1h, total volume, total makers, price change, etc.) and outputs
 * data formatted for the LLM. Excludes tokens we already hold (from clanker_bags.json)
 * so the model does not try to buy the same token twice.
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";

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

/** Load set of token addresses we already hold (lowercased) from clanker_bags.json. */
function loadHeldTokenAddresses(statePath: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!statePath || typeof statePath !== "string") return set;
  const bagsPath = path.join(path.dirname(statePath), "clanker_bags.json");
  try {
    if (!fs.existsSync(bagsPath)) return set;
    const raw = fs.readFileSync(bagsPath, "utf-8");
    const bagState = JSON.parse(raw) as { holdings?: Record<string, unknown> };
    const holdings = bagState?.holdings ?? {};
    for (const addr of Object.keys(holdings)) {
      set.add(addr.toLowerCase());
    }
  } catch {
    // ignore missing or invalid bags file
  }
  return set;
}

export class ClankerLaunchSummaryNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false) {
      logger.debug("[ClankerLaunchSummary] trigger=false (insufficient funds), skipping");
      return {
        recent_launches: [],
        summary: "Insufficient funds.",
        count: 0,
        text: "Insufficient funds.",
      };
    }

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
        logger.warn(`[ClankerLaunchSummary] Failed to read state from ${abbrevPathForLog(statePath)}: ${e}`);
      }
    }

    const tokens = (state?.tokens as Record<string, Record<string, unknown>>) ?? {};
    const recentLaunches = Array.isArray(state?.recentLaunches)
      ? (state.recentLaunches as Record<string, unknown>[])
      : [];

    const heldAddresses = loadHeldTokenAddresses(statePath);

    const now = Date.now();
    const cutoff = now - windowHours * ONE_HOUR_MS;
    const inWindow = recentLaunches.filter((l) => (getNum(l.launchTime) || 0) >= cutoff);
    // Exclude tokens we already hold so the model doesn't try to buy them again
    const notHeld = heldAddresses.size
      ? inWindow.filter((l) => !heldAddresses.has(getStr(l.tokenAddress).toLowerCase()))
      : inWindow;
    // Enrich with token stats so we can sort by volume
    const withStats = notHeld.map((launch) => {
      const addr = getStr(launch.tokenAddress).toLowerCase();
      const t = tokens[addr] ?? {};
      return {
        launch,
        volume1h: getNum(t.volume1h),
        volume24h: getNum(t.volume24h),
      };
    });
    // Sort by top volume (1h then 24h), take limit
    withStats.sort((a, b) => (b.volume1h || 0) - (a.volume1h || 0) || (b.volume24h || 0) - (a.volume24h || 0));
    const slice = withStats.slice(0, limit);

    const enriched = slice.map(({ launch }) => {
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
        volume1m: getNum(t.volume1m),
        volume5m: getNum(t.volume5m),
        volume15m: getNum(t.volume15m),
        volume30m: getNum(t.volume30m),
        volume1h: getNum(t.volume1h),
        totalMakers: getNum(t.totalMakers),
        lastPrice: getNum(t.lastPrice),
        priceChange1m: getNum(t.priceChange1m),
        priceChange5m: getNum(t.priceChange5m),
        priceChange15m: getNum(t.priceChange15m),
        priceChange30m: getNum(t.priceChange30m),
        priceChange1h: getNum(t.priceChange1h),
      };
    });

    const lines = enriched.map(
      (e) => {
        const name = getStr(e.name) || getStr(e.symbol) || "?";
        const symbol = getStr(e.symbol) || getStr(e.name) || "?";
        return `- ${name} (${symbol}): vol24h=${getNum(e.volume24h).toFixed(4)}ETH vol1h=${getNum(e.volume1h).toFixed(4)}ETH vol5m=${getNum(e.volume5m).toFixed(4)}ETH vol1m=${getNum(e.volume1m).toFixed(4)}ETH makers=${getNum(e.totalMakers)} swaps=${getNum(e.totalSwaps)} priceChange1m=${getNum(e.priceChange1m)}% priceChange5m=${getNum(e.priceChange5m)}% priceChange1h=${getNum(e.priceChange1h)}%`;
      }
    );
    const summary =
      `Recent Clanker launches (past ${windowHours}h). Volumes in ETH; price deltas: 1m, 5m, 1h.\n` + (lines.length ? lines.join("\n") : "(none)");

    return {
      recent_launches: enriched,
      summary,
      count: enriched.length,
      text: summary,
    };
  }
}
