/**
 * In-memory state and JSON persist/load. Swaps (24h window) live in swaps24h and clanker_swaps.json.
 */
import fs from "fs";
import path from "path";
import type { ClankerState, ClankerSwapsFile, TokenState, LaunchEvent, SwapItem } from "./types.js";
import { RECENT_LAUNCHES_MAX, MAX_SWAPS_24H_PER_TOKEN } from "./constants.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

export class StateManager {
  private state: ClankerState = {
    lastUpdated: 0,
    tokens: {},
    recentLaunches: [],
  };
  private stateFilePath: string;
  private swapsFilePath: string;
  private persistIntervalId: ReturnType<typeof setInterval> | null = null;
  private swapsPersistIntervalId: ReturnType<typeof setInterval> | null = null;
  /** 24h of swaps per token (in-memory); persisted to clanker_swaps.json every minute. */
  private swaps24h: Map<string, SwapItem[]> = new Map();

  constructor(stateFilePath: string) {
    this.stateFilePath = stateFilePath;
    this.swapsFilePath = path.join(path.dirname(stateFilePath), "clanker_swaps.json");
  }

  load(): void {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
    if (!fs.existsSync(this.stateFilePath)) return;
    try {
      const raw = fs.readFileSync(this.stateFilePath, "utf-8");
      const data = JSON.parse(raw) as ClankerState & { tokens: Record<string, TokenState & { last20Swaps?: SwapItem[] }> };
      this.state = {
        lastUpdated: data.lastUpdated ?? 0,
        tokens: data.tokens ?? {},
        recentLaunches: Array.isArray(data.recentLaunches) ? data.recentLaunches : [],
      };
      this.swaps24h.clear();
      if (fs.existsSync(this.swapsFilePath)) {
        try {
          const swapsRaw = fs.readFileSync(this.swapsFilePath, "utf-8");
          const swapsData = JSON.parse(swapsRaw) as ClankerSwapsFile;
          const byToken = swapsData.swapsByToken ?? {};
          for (const [addr, arr] of Object.entries(byToken)) {
            if (Array.isArray(arr)) this.swaps24h.set(addr.toLowerCase(), arr);
          }
        } catch (e) {
          console.warn("[Clanker] Failed to load swaps file:", e);
        }
      }
      const now = Date.now();
      for (const t of Object.values(this.state.tokens)) {
        const addr = t.tokenAddress.toLowerCase();
        let list = this.swaps24h.get(addr);
        const legacy = (t as TokenState & { last20Swaps?: SwapItem[] }).last20Swaps;
        if (Array.isArray(legacy) && legacy.length > 0) {
          const migrated = legacy.map((s) => ({ timestamp: s.timestamp, side: s.side, volumeEth: s.volumeEth, sender: s.sender, priceEth: s.priceEth, priceUsd: s.priceUsd }));
          const merged = list ? [...list, ...migrated] : migrated;
          const seen = new Set<string>();
          const deduped = merged.filter((s) => {
            const key = `${s.timestamp}|${s.sender ?? ""}|${s.volumeEth}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          list = deduped;
          this.swaps24h.set(addr, list);
        }
        if (!list) this.swaps24h.set(addr, []);
        const listToTrim = this.swaps24h.get(addr)!;
        const trimmed = this.trimSwapsTo24h(listToTrim, now);
        this.swaps24h.set(addr, trimmed);
        this.deriveMetricsFromSwaps(t, trimmed, now);
        delete (t as unknown as Record<string, unknown>).last20Swaps;
      }
      console.log(
        `[Clanker] Loaded state: ${Object.keys(this.state.tokens).length} tokens, ${this.state.recentLaunches.length} recent launches`
      );
    } catch (e) {
      console.warn("[Clanker] Failed to load state file:", e);
    }
  }

  persist(): void {
    const dir = path.dirname(this.stateFilePath);
    fs.mkdirSync(dir, { recursive: true });
    this.state.lastUpdated = Date.now();
    try {
      fs.writeFileSync(
        this.stateFilePath,
        JSON.stringify(this.state, null, 2),
        "utf-8"
      );
    } catch (e) {
      console.error("[Clanker] Failed to persist state:", e);
    }
  }

  /** Persist 24h swaps to clanker_swaps.json (called on interval, e.g. every 1 min). */
  persistSwaps(): void {
    const dir = path.dirname(this.swapsFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const cutoff24h = now - TWENTY_FOUR_HOURS_MS;
    const swapsByToken: Record<string, SwapItem[]> = {};
    for (const [addr, list] of this.swaps24h) {
      const trimmed = list
        .filter((s) => s.timestamp >= cutoff24h)
        .sort((a, b) => a.timestamp - b.timestamp);
      const capped = trimmed.length > MAX_SWAPS_24H_PER_TOKEN ? trimmed.slice(-MAX_SWAPS_24H_PER_TOKEN) : trimmed;
      if (capped.length > 0) swapsByToken[addr] = capped;
    }
    try {
      fs.writeFileSync(
        this.swapsFilePath,
        JSON.stringify({ lastUpdated: now, swapsByToken }, null, 2),
        "utf-8"
      );
    } catch (e) {
      console.error("[Clanker] Failed to persist swaps file:", e);
    }
  }

  startPersistInterval(intervalMs: number): void {
    this.persistIntervalId = setInterval(() => this.persist(), intervalMs);
  }

  startSwapsPersistInterval(intervalMs: number): void {
    this.swapsPersistIntervalId = setInterval(() => this.persistSwaps(), intervalMs);
  }

  stopPersistInterval(): void {
    if (this.persistIntervalId) {
      clearInterval(this.persistIntervalId);
      this.persistIntervalId = null;
    }
    if (this.swapsPersistIntervalId) {
      clearInterval(this.swapsPersistIntervalId);
      this.swapsPersistIntervalId = null;
    }
  }

  getState(): ClankerState {
    return this.state;
  }

  getToken(tokenAddress: string): TokenState | undefined {
    return this.state.tokens[tokenAddress.toLowerCase()];
  }

  getTrackedPoolIds(): Set<string> {
    const set = new Set<string>();
    for (const t of Object.values(this.state.tokens)) {
      set.add(t.poolId.toLowerCase());
    }
    return set;
  }

  /**
   * Remove tokens where both volume1h and volume5m are below minVolumeEth.
   * Bags live on the workflow host only; no cross-host dependency.
   */
  cleanupDeadTokens(minVolumeEth: number): number {
    const toRemove: string[] = [];
    for (const [addr, t] of Object.entries(this.state.tokens)) {
      const v1h = t.volume1h ?? 0;
      const v5m = t.volume5m ?? 0;
      if (v1h < minVolumeEth && v5m < minVolumeEth) toRemove.push(addr);
    }
    for (const addr of toRemove) {
      delete this.state.tokens[addr];
      this.swaps24h.delete(addr);
    }
    const removedSet = new Set(toRemove);
    this.state.recentLaunches = this.state.recentLaunches.filter(
      (e) => !removedSet.has(e.tokenAddress.toLowerCase())
    );
    if (toRemove.length > 0) {
      this.persist();
      console.log(`[Clanker] Cleanup removed ${toRemove.length} dead token(s): ${toRemove.join(", ")}`);
    }
    return toRemove.length;
  }

  addLaunch(event: LaunchEvent): void {
    const tokenAddress = event.tokenAddress.toLowerCase();
    if (this.state.tokens[tokenAddress]) return; // already tracked
    const tokenState: TokenState = {
      tokenAddress,
      currency0: event.currency0 ?? "",
      currency1: event.currency1 ?? "",
      poolId: event.poolId,
      hookAddress: event.hookAddress,
      feeTier: event.feeTier,
      tickSpacing: event.tickSpacing,
      launchTime: event.launchTime,
      totalSwaps: 0,
      totalBuys: 0,
      totalSells: 0,
      volume24h: 0,
      totalMakers: 0,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      name: event.name ?? "",
      symbol: event.symbol ?? "",
      tokenImage: event.tokenImage ?? "",
      tokenMetadata: event.tokenMetadata ?? "",
      decimals: event.decimals,
      totalSupply: event.totalSupply,
    };
    this.state.tokens[tokenAddress] = tokenState;
    this.state.recentLaunches.unshift({
      tokenAddress: event.tokenAddress,
      currency0: event.currency0,
      currency1: event.currency1,
      poolId: event.poolId,
      hookAddress: event.hookAddress,
      feeTier: event.feeTier,
      tickSpacing: event.tickSpacing,
      launchTime: event.launchTime,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      name: event.name ?? "",
      symbol: event.symbol ?? "",
      tokenImage: event.tokenImage ?? "",
      tokenMetadata: event.tokenMetadata ?? "",
      decimals: event.decimals,
      totalSupply: event.totalSupply,
    });
    if (this.state.recentLaunches.length > RECENT_LAUNCHES_MAX) {
      this.state.recentLaunches = this.state.recentLaunches.slice(0, RECENT_LAUNCHES_MAX);
    }
  }

  recordSwap(
    poolId: string,
    side: "buy" | "sell",
    volumeEth: number,
    timestamp: number,
    sender?: string,
    priceEth?: number
  ): void {
    const poolIdLower = poolId.toLowerCase();
    for (const t of Object.values(this.state.tokens)) {
      if (t.poolId.toLowerCase() === poolIdLower) {
        let list = this.swaps24h.get(t.tokenAddress);
        if (!list) {
          list = [];
          this.swaps24h.set(t.tokenAddress, list);
        }
        list.push({ timestamp, side, volumeEth, sender, priceEth });
        const trimmed = this.trimSwapsTo24h(list, timestamp);
        this.swaps24h.set(t.tokenAddress, trimmed);
        t.totalSwaps += 1;
        if (side === "buy") t.totalBuys += 1;
        else t.totalSells += 1;
        this.deriveMetricsFromSwaps(t, trimmed, timestamp);
        return;
      }
    }
  }

  /** Trim swap list to 24h and cap length; returns new array. Sorted by timestamp ascending so slice retains most recent. */
  private trimSwapsTo24h(list: SwapItem[], now: number): SwapItem[] {
    const cutoff = now - TWENTY_FOUR_HOURS_MS;
    const trimmed = list.filter((s) => s.timestamp >= cutoff).sort((a, b) => a.timestamp - b.timestamp);
    return trimmed.length > MAX_SWAPS_24H_PER_TOKEN ? trimmed.slice(-MAX_SWAPS_24H_PER_TOKEN) : trimmed;
  }

  /** Derive volume24h, volume1m–1h, totalMakers, lastPrice, priceChange* from 24h swap list and set on token. */
  private deriveMetricsFromSwaps(token: TokenState, swaps: SwapItem[], now: number): void {
    token.volume24h = this.sumVolumeInWindow(swaps, now, TWENTY_FOUR_HOURS_MS);
    token.volume1h = this.sumVolumeInWindow(swaps, now, ONE_HOUR_MS);
    token.volume30m = this.sumVolumeInWindow(swaps, now, THIRTY_MIN_MS);
    token.volume15m = this.sumVolumeInWindow(swaps, now, FIFTEEN_MIN_MS);
    token.volume5m = this.sumVolumeInWindow(swaps, now, FIVE_MIN_MS);
    token.volume1m = this.sumVolumeInWindow(swaps, now, ONE_MIN_MS);
    const senders = new Set<string>();
    for (const s of swaps) {
      if (s.sender) senders.add(s.sender.toLowerCase());
    }
    token.totalMakers = senders.size;
    const byTime = [...swaps].sort((a, b) => a.timestamp - b.timestamp);
    const withPrice = byTime.filter((s) => (s.priceEth ?? s.priceUsd) != null && (s.priceEth ?? s.priceUsd)! > 0);
    if (withPrice.length > 0) {
      const latest = withPrice[withPrice.length - 1];
      token.lastPrice = latest.priceEth ?? latest.priceUsd;
    }
    this.updatePriceChanges(swaps, token, now);
  }

  private sumVolumeInWindow(swaps: SwapItem[], now: number, windowMs: number): number {
    const cutoff = now - windowMs;
    return swaps.filter((s) => s.timestamp >= cutoff).reduce((sum, s) => sum + s.volumeEth, 0);
  }

  /** Compute price change % for 1m, 5m, 15m, 30m, 1h from swap list (priceEth or legacy priceUsd). */
  private updatePriceChanges(swaps: SwapItem[], token: TokenState, now: number): void {
    const current = token.lastPrice;
    if (current == null || current <= 0) return;
    const intervals = [
      { key: "priceChange1m" as const, ms: ONE_MIN_MS },
      { key: "priceChange5m" as const, ms: FIVE_MIN_MS },
      { key: "priceChange15m" as const, ms: FIFTEEN_MIN_MS },
      { key: "priceChange30m" as const, ms: THIRTY_MIN_MS },
      { key: "priceChange1h" as const, ms: ONE_HOUR_MS },
    ];
    for (const { key, ms } of intervals) {
      const cutoff = now - ms;
      const inWindow = swaps
        .filter((s) => {
          const p = s.priceEth ?? s.priceUsd;
          return s.timestamp >= cutoff && p != null && p > 0;
        })
        .sort((a, b) => a.timestamp - b.timestamp);
      const pastPrice = inWindow.length ? (inWindow[0].priceEth ?? inWindow[0].priceUsd)! : undefined;
      if (pastPrice != null && pastPrice > 0) {
        token[key] = ((current - pastPrice) / pastPrice) * 100;
      }
    }
  }
}
