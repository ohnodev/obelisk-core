/**
 * In-memory state and JSON persist/load.
 */
import fs from "fs";
import path from "path";
import type { ClankerState, TokenState, LaunchEvent } from "./types.js";
import {
  RECENT_LAUNCHES_MAX,
  LAST_N_SWAPS,
} from "./constants.js";

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
  private persistIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(stateFilePath: string) {
    this.stateFilePath = stateFilePath;
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
      const data = JSON.parse(raw) as ClankerState;
      this.state = {
        lastUpdated: data.lastUpdated ?? 0,
        tokens: data.tokens ?? {},
        recentLaunches: Array.isArray(data.recentLaunches) ? data.recentLaunches : [],
      };
      for (const t of Object.values(this.state.tokens)) {
        const senders = new Set<string>();
        for (const swap of t.last20Swaps ?? []) {
          if (swap.sender) senders.add(swap.sender.toLowerCase());
        }
        if (senders.size > 0) {
          this.uniqueSenders.set(t.tokenAddress, senders);
          t.totalMakers = senders.size;
        }
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

  startPersistInterval(intervalMs: number): void {
    this.persistIntervalId = setInterval(() => this.persist(), intervalMs);
  }

  stopPersistInterval(): void {
    if (this.persistIntervalId) {
      clearInterval(this.persistIntervalId);
      this.persistIntervalId = null;
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
      last20Swaps: [],
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
        t.totalSwaps += 1;
        if (side === "buy") t.totalBuys += 1;
        else t.totalSells += 1;
        t.volume24h = this.trimAndSum24h(t, volumeEth, timestamp);
        if (priceEth != null && priceEth > 0) t.lastPrice = priceEth;
        t.last20Swaps.push({ timestamp, side, volumeEth, sender, priceEth });
        if (t.last20Swaps.length > LAST_N_SWAPS) {
          t.last20Swaps = t.last20Swaps.slice(-LAST_N_SWAPS);
        }
        if (sender) {
          let set = this.uniqueSenders.get(t.tokenAddress);
          if (!set) {
            set = new Set<string>();
            this.uniqueSenders.set(t.tokenAddress, set);
          }
          set.add(sender.toLowerCase());
          t.totalMakers = set.size;
        }
        this.updateIntervalVolumes(t, timestamp);
        return;
      }
    }
  }

  private uniqueSenders: Map<string, Set<string>> = new Map();

  private updateIntervalVolumes(token: TokenState, timestamp: number): void {
    const events = this.volumeEvents.get(token.tokenAddress);
    if (!events) return;
    token.volume1h = this.sumInWindow(events, timestamp, ONE_HOUR_MS);
    token.volume30m = this.sumInWindow(events, timestamp, THIRTY_MIN_MS);
    token.volume15m = this.sumInWindow(events, timestamp, FIFTEEN_MIN_MS);
    token.volume5m = this.sumInWindow(events, timestamp, FIVE_MIN_MS);
    token.volume1m = this.sumInWindow(events, timestamp, ONE_MIN_MS);
    this.updatePriceChanges(token, timestamp);
  }

  /** Compute price change % for 1m, 5m, 15m, 30m, 1h from last20Swaps (priceEth or legacy priceUsd). */
  private updatePriceChanges(token: TokenState, now: number): void {
    const swaps = token.last20Swaps ?? [];
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

  private sumInWindow(
    events: Array<{ timestamp: number; volumeEth: number }>,
    now: number,
    windowMs: number
  ): number {
    const cutoff = now - windowMs;
    return events.filter((e) => e.timestamp >= cutoff).reduce((s, e) => s + e.volumeEth, 0);
  }

  /** Per-token 24h volume (ETH): in-memory list for 24h sum and interval stats. */
  private volumeEvents: Map<string, Array<{ timestamp: number; volumeEth: number }>> = new Map();

  private trimAndSum24h(token: TokenState, newVolumeEth: number, timestamp: number): number {
    let events = this.volumeEvents.get(token.tokenAddress);
    if (!events) {
      events = [];
      this.volumeEvents.set(token.tokenAddress, events);
    }
    events.push({ timestamp, volumeEth: newVolumeEth });
    const cutoff = timestamp - TWENTY_FOUR_HOURS_MS;
    while (events.length && events[0].timestamp < cutoff) events.shift();
    const sum = events.reduce((s, e) => s + e.volumeEth, 0);
    this.updateIntervalVolumes(token, timestamp);
    return sum;
  }
}
