/**
 * ClankerLaunchSummaryNode – reads Clanker state from Blockchain Config,
 * filters to recent launches, enriches with token stats. Excludes tokens we hold
 * (from clanker_bags.json at storage_instance.basePath or clanker_storage_path).
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { resolveBagsPath, resolveActionsPath } from "./clankerStoragePath";

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

/** Format an ETH price so tiny values (< 1e-6) use scientific notation instead of rounding to 0. */
function fmtPrice(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) < 1e-6) return v.toExponential(2);
  return v.toFixed(8);
}

interface HeldToken {
  address: string;
  boughtAtPriceEth: number;
  boughtAtTimestamp: number;
  amountWei: string;
}

interface HeldTokensResult {
  addresses: Set<string>;
  holdings: HeldToken[];
}

function loadHeldTokens(bagsPath: string): HeldTokensResult {
  const addresses = new Set<string>();
  const holdings: HeldToken[] = [];
  if (!bagsPath) return { addresses, holdings };
  try {
    if (!fs.existsSync(bagsPath)) return { addresses, holdings };
    const raw = fs.readFileSync(bagsPath, "utf-8");
    const bagState = JSON.parse(raw) as { holdings?: Record<string, Record<string, unknown>> };
    const h = bagState?.holdings ?? {};
    for (const [addr, data] of Object.entries(h)) {
      const lc = addr.toLowerCase();
      addresses.add(lc);
      holdings.push({
        address: lc,
        boughtAtPriceEth: getNum(data?.boughtAtPriceEth),
        boughtAtTimestamp: getNum(data?.boughtAtTimestamp),
        amountWei: getStr(data?.amountWei) || "0",
      });
    }
  } catch {
    // ignore
  }
  return { addresses, holdings };
}

interface ActionEntry {
  type: string;
  tokenAddress?: string;
  amountWei?: string;
  valueWei?: string;
  costWei?: string;
  costEth?: number;
  pnlEth?: number;
  name?: string;
  symbol?: string;
  txHash?: string;
  reason?: string;
  timestamp: number;
}

const ETH_WEI = 1e18;
const DEFAULT_MAX_RECENT_ACTIONS = 5;

/**
 * Load recent trade actions and compute PnL for sells by matching
 * each sell with the most recent preceding buy of the same token.
 */
function loadRecentActions(actionsPath: string, maxActions: number): ActionEntry[] {
  if (!actionsPath) return [];
  try {
    if (!fs.existsSync(actionsPath)) return [];
    const raw = fs.readFileSync(actionsPath, "utf-8");
    const data = JSON.parse(raw);
    const all: ActionEntry[] = Array.isArray(data) ? data : (data?.actions ?? []);
    const trades = all.filter((e) => e.type === "buy" || e.type === "sell");

    // Compute PnL for sells that don't already have it
    const lastBuyByToken = new Map<string, ActionEntry>();
    for (const t of trades) {
      const addr = (t.tokenAddress ?? "").toLowerCase();
      if (t.type === "buy") {
        lastBuyByToken.set(addr, t);
      } else if (t.type === "sell" && t.pnlEth == null) {
        const buy = lastBuyByToken.get(addr);
        if (buy) {
          const buyCostEth = buy.costWei
            ? Number(buy.costWei) / ETH_WEI
            : buy.valueWei
              ? Number(buy.valueWei) / ETH_WEI
              : 0;
          // Pro-rate buy cost for partial sells
          const buyAmt = buy.amountWei ? Number(buy.amountWei) : 0;
          const sellAmt = t.amountWei ? Number(t.amountWei) : 0;
          const fraction = buyAmt > 0 && sellAmt > 0 ? sellAmt / buyAmt : 1;
          const proratedCostEth = buyCostEth * Math.min(fraction, 1);
          const receivedEth = t.valueWei ? Number(t.valueWei) / ETH_WEI : 0;
          t.pnlEth = receivedEth - proratedCostEth;
          if (!t.name && buy.name) t.name = buy.name;
          if (!t.symbol && buy.symbol) t.symbol = buy.symbol;
        }
      }
    }

    return trades.slice(-maxActions);
  } catch {
    return [];
  }
}

function formatRelativeTime(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h ago` : `${h}h${m}m ago`;
  }
  return `${mins}m ago`;
}

export function formatRecentActions(
  actions: ActionEntry[],
  tokens: Record<string, Record<string, unknown>>,
  now: number
): string {
  if (actions.length === 0) return "Recent Trades: none\n";

  const lines = actions.map((a) => {
    const addr = (a.tokenAddress ?? "").toLowerCase();
    const t = tokens[addr] ?? {};
    // Prefer name/symbol stored on the action, then fall back to token state
    const name =
      getStr(a.symbol) || getStr(a.name) ||
      getStr(t.symbol) || getStr(t.name) ||
      (addr ? addr.slice(0, 10) : "?");
    const ago = formatRelativeTime(now - a.timestamp);
    const valueEth = a.valueWei ? Number(a.valueWei) / ETH_WEI : 0;

    if (a.type === "buy") {
      return `- BUY ${name}: spent ${fmtPrice(valueEth)} ETH, ${ago}`;
    }

    // Show PnL in ETH and percentage for sells
    let pnlStr = "";
    if (a.pnlEth != null) {
      const sign = a.pnlEth >= 0 ? "+" : "";
      pnlStr = `, P&L: ${sign}${fmtPrice(a.pnlEth)} ETH`;
      // Calculate percentage if we can infer the cost
      const costEth = valueEth - a.pnlEth;
      if (costEth > 0) {
        const pct = (a.pnlEth / costEth) * 100;
        pnlStr += ` (${sign}${pct.toFixed(1)}%)`;
      }
    }
    return `- SELL ${name}: received ${fmtPrice(valueEth)} ETH${pnlStr}, ${ago}`;
  });

  return `Recent Trades (last ${actions.length}):\n${lines.join("\n")}\n`;
}

export function formatHoldingsSummary(
  holdings: HeldToken[],
  tokens: Record<string, Record<string, unknown>>,
  now: number
): string {
  if (holdings.length === 0) return "Current Holdings: none\n";

  const lines = holdings.map((h) => {
    const t = tokens[h.address] ?? {};
    const name = getStr(t.name) || getStr(t.symbol) || h.address.slice(0, 10);
    const symbol = getStr(t.symbol) || getStr(t.name) || "?";
    const currentPrice = getNum(t.lastPrice);
    const buyPrice = h.boughtAtPriceEth;
    const pnl = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;
    const pnlStr = pnl >= 0 ? `+${pnl.toFixed(1)}%` : `${pnl.toFixed(1)}%`;
    const heldMs = now - h.boughtAtTimestamp;
    const heldMin = Math.max(0, Math.floor(heldMs / 60_000));
    const heldStr = heldMin >= 60
      ? (heldMin % 60 === 0 ? `${Math.floor(heldMin / 60)}h` : `${Math.floor(heldMin / 60)}h${heldMin % 60}m`)
      : `${heldMin}m`;
    return `- ${name} (${symbol}): bought ${fmtPrice(buyPrice)} ETH, now ${fmtPrice(currentPrice)} ETH, P&L: ${pnlStr}, held ${heldStr}`;
  });

  return `Current Holdings (${holdings.length} position${holdings.length !== 1 ? "s" : ""}):\n${lines.join("\n")}\n`;
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
        : 5;
    const maxPosRaw = this.getInputValue("max_positions", context, undefined);
    const maxPositions =
      maxPosRaw != null && Number.isFinite(Number(maxPosRaw))
        ? Math.max(1, Math.min(50, Number(maxPosRaw)))
        : 3;
    const maxRecentActionsRaw = this.getInputValue("max_recent_actions", context, this.metadata.max_recent_actions ?? undefined);
    const maxRecentActions =
      maxRecentActionsRaw != null && Number.isFinite(Number(maxRecentActionsRaw))
        ? Math.max(1, Math.min(20, Number(maxRecentActionsRaw)))
        : DEFAULT_MAX_RECENT_ACTIONS;

    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const bagsPath = resolveBagsPath(this, context);
    const actionsPath = resolveActionsPath(this, context);
    const tokens = (state?.tokens as Record<string, Record<string, unknown>>) ?? {};
    const recentLaunches = Array.isArray(state?.recentLaunches)
      ? (state.recentLaunches as Record<string, unknown>[])
      : [];
    const { addresses: heldAddresses, holdings: heldTokens } = loadHeldTokens(bagsPath);

    // Gate: if we already hold max positions, skip inference
    if (heldTokens.length >= maxPositions) {
      const fullSummary = formatHoldingsSummary(heldTokens, tokens, Date.now())
        + `\nMax positions reached (${heldTokens.length}/${maxPositions}). Not looking for new buys.`;
      logger.info(`[ClankerLaunchSummary] At max positions (${heldTokens.length}/${maxPositions}), skipping`);
      return {
        recent_launches: [],
        summary: fullSummary,
        count: 0,
        text: fullSummary,
        has_tokens: false,
      };
    }

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

    // ── Holdings summary ──────────────────────────────────────────────
    const holdingsSummary = formatHoldingsSummary(heldTokens, tokens, now);

    // ── Recent trade history ──────────────────────────────────────────
    const recentActions = loadRecentActions(actionsPath, maxRecentActions);
    const tradeHistorySummary = formatRecentActions(recentActions, tokens, now);

    // ── Candidates summary ───────────────────────────────────────────
    const lines = enriched.map(
      (e) => {
        const name = getStr(e.name) || getStr(e.symbol) || "?";
        const symbol = getStr(e.symbol) || getStr(e.name) || "?";
        return `- ${name} (${symbol}): vol24h=${getNum(e.volume24h).toFixed(4)}ETH vol1h=${getNum(e.volume1h).toFixed(4)}ETH vol5m=${getNum(e.volume5m).toFixed(4)}ETH vol1m=${getNum(e.volume1m).toFixed(4)}ETH makers=${getNum(e.totalMakers)} swaps=${getNum(e.totalSwaps)} priceChange1m=${getNum(e.priceChange1m)}% priceChange5m=${getNum(e.priceChange5m)}% priceChange1h=${getNum(e.priceChange1h)}%`;
      }
    );
    const candidatesHeader = `Top ${limit} Clanker candidates (past ${windowHours}h). Volumes in ETH; price deltas: 1m, 5m, 1h.\n`;
    const summary = holdingsSummary + "\n" + tradeHistorySummary + "\n" + candidatesHeader + (lines.length ? lines.join("\n") : "(none)");

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
