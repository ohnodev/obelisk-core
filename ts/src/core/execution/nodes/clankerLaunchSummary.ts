/**
 * ClankerLaunchSummaryNode – reads Clanker state from Blockchain Config,
 * filters to recent launches, enriches with token stats. Excludes tokens we hold
 * (from clanker_bags.json at clanker_storage_path / base_path / storage_instance).
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { resolveBagsPath } from "./clankerStoragePath";

const logger = getLogger("clankerLaunchSummary");

const ONE_HOUR_MS = 60 * 60 * 1000;
/** Minimum volume (ETH) in the past hour to include a token in the summary. */
const MIN_VOLUME_1H_ETH = 0.01;

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function loadHeldTokenAddresses(bagsPath: string): Set<string> {
  const set = new Set<string>();
  if (!bagsPath) return set;
  try {
    if (!fs.existsSync(bagsPath)) return set;
    const raw = fs.readFileSync(bagsPath, "utf-8");
    const bagState = JSON.parse(raw) as { holdings?: Record<string, unknown> };
    const holdings = bagState?.holdings ?? {};
    for (const addr of Object.keys(holdings)) set.add(addr.toLowerCase());
  } catch {
    // ignore
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
        has_tokens: false,
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

    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const bagsPath = resolveBagsPath(this, context);
    const tokens = (state?.tokens as Record<string, Record<string, unknown>>) ?? {};
    const recentLaunches = Array.isArray(state?.recentLaunches)
      ? (state.recentLaunches as Record<string, unknown>[])
      : [];
    const heldAddresses = loadHeldTokenAddresses(bagsPath);

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
    // Only include tokens with at least MIN_VOLUME_1H_ETH in the past hour
    const meetsMinVolume = withStats.filter((x) => (x.volume1h ?? 0) >= MIN_VOLUME_1H_ETH);
    meetsMinVolume.sort((a, b) => (b.volume1h || 0) - (a.volume1h || 0) || (b.volume24h || 0) - (a.volume24h || 0));
    const slice = meetsMinVolume.slice(0, limit);

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
        tickSpacing: getNum(launch.tickSpacing) || getNum(t.tickSpacing) || 200,
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

    const hasTokens = enriched.length > 0;
    return {
      recent_launches: enriched,
      summary,
      count: enriched.length,
      text: summary,
      has_tokens: hasTokens,
    };
  }
}
