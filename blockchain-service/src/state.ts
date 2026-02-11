/**
 * In-memory state and JSON persist/load (buybotv2-style).
 */
import fs from "fs";
import path from "path";
import type { ClankerState, TokenState, LaunchEvent } from "./types.js";
import {
  RECENT_LAUNCHES_MAX,
  LAST_N_SWAPS,
} from "./constants.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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
    });
    if (this.state.recentLaunches.length > RECENT_LAUNCHES_MAX) {
      this.state.recentLaunches = this.state.recentLaunches.slice(0, RECENT_LAUNCHES_MAX);
    }
  }

  recordSwap(
    poolId: string,
    side: "buy" | "sell",
    volumeUsd: number,
    timestamp: number
  ): void {
    const poolIdLower = poolId.toLowerCase();
    for (const t of Object.values(this.state.tokens)) {
      if (t.poolId.toLowerCase() === poolIdLower) {
        t.totalSwaps += 1;
        if (side === "buy") t.totalBuys += 1;
        else t.totalSells += 1;
        t.volume24h = this.trimAndSum24h(t, volumeUsd, timestamp);
        t.last20Swaps.push({ timestamp, side, volumeUsd });
        if (t.last20Swaps.length > LAST_N_SWAPS) {
          t.last20Swaps = t.last20Swaps.slice(-LAST_N_SWAPS);
        }
        return;
      }
    }
  }

  /** Per-token 24h volume: we don't store full event list in JSON for lean size; we keep a small in-memory list for 24h sum. */
  private volumeEvents: Map<string, Array<{ timestamp: number; volumeUsd: number }>> = new Map();

  private trimAndSum24h(token: TokenState, newVolumeUsd: number, timestamp: number): number {
    let events = this.volumeEvents.get(token.tokenAddress);
    if (!events) {
      events = [];
      this.volumeEvents.set(token.tokenAddress, events);
    }
    events.push({ timestamp, volumeUsd: newVolumeUsd });
    const cutoff = timestamp - TWENTY_FOUR_HOURS_MS;
    while (events.length && events[0].timestamp < cutoff) events.shift();
    return events.reduce((s, e) => s + e.volumeUsd, 0);
  }
}
