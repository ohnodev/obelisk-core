/**
 * Unit test: ClankerLaunchSummaryNode selects tokens launched in the past hour,
 * sorted by top volume, with 1m/5m/15m/30m/1h volume and price movement fields.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ClankerLaunchSummaryNode } from "../src/core/execution/nodes/clankerLaunchSummary";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import type { NodeData } from "../src/core/types";
import type { ExecutionContext } from "../src/core/execution/nodeBase";

const ONE_HOUR_MS = 60 * 60 * 1000;
const now = Date.now();

const VOLUME_PRICE_KEYS = [
  "volume1m",
  "volume5m",
  "volume15m",
  "volume30m",
  "volume1h",
  "priceChange1m",
  "priceChange5m",
  "priceChange15m",
  "priceChange30m",
  "priceChange1h",
] as const;

function makeFixtureState() {
  const t1 = "0x1111111111111111111111111111111111111111";
  const t2 = "0x2222222222222222222222222222222222222222";
  const t3 = "0x3333333333333333333333333333333333333333";
  const launchTime = now - 30 * 60 * 1000; // 30 min ago
  const tokens: Record<string, Record<string, unknown>> = {
    [t1]: {
      tokenAddress: t1,
      name: "Low",
      symbol: "LOW",
      poolId: "0xaa",
      hookAddress: "0xbb",
      feeTier: 8388608,
      tickSpacing: 200,
      launchTime,
      volume24h: 100,
      volume1m: 1,
      volume5m: 5,
      volume15m: 15,
      volume30m: 30,
      volume1h: 10,
      totalSwaps: 2,
      totalMakers: 1,
      lastPrice: 1.5,
      priceChange1m: 0.5,
      priceChange5m: 1,
      priceChange15m: 2,
      priceChange30m: 3,
      priceChange1h: 5,
    },
    [t2]: {
      tokenAddress: t2,
      name: "High",
      symbol: "HIGH",
      poolId: "0xcc",
      hookAddress: "0xdd",
      feeTier: 8388608,
      tickSpacing: 200,
      launchTime,
      volume24h: 500,
      volume1m: 10,
      volume5m: 50,
      volume15m: 150,
      volume30m: 300,
      volume1h: 200,
      totalSwaps: 10,
      totalMakers: 5,
      lastPrice: 2,
      priceChange1m: -1,
      priceChange5m: 2,
      priceChange15m: 4,
      priceChange30m: 6,
      priceChange1h: 10,
    },
    [t3]: {
      tokenAddress: t3,
      name: "Mid",
      symbol: "MID",
      poolId: "0xee",
      hookAddress: "0xff",
      feeTier: 8388608,
      tickSpacing: 200,
      launchTime,
      volume24h: 200,
      volume1m: 2,
      volume5m: 20,
      volume15m: 60,
      volume30m: 120,
      volume1h: 80,
      totalSwaps: 5,
      totalMakers: 2,
      lastPrice: 1,
      priceChange1m: 0,
      priceChange5m: 0.5,
      priceChange15m: 1,
      priceChange30m: 1.5,
      priceChange1h: 2,
    },
  };
  const recentLaunches = [
    { tokenAddress: t1, name: "Low", symbol: "LOW", launchTime, poolId: "0xaa", hookAddress: "0xbb", feeTier: 8388608, tickSpacing: 200, currency0: "", currency1: "", blockNumber: 1, transactionHash: "0x", tokenImage: "", tokenMetadata: "", decimals: 18, totalSupply: "0" },
    { tokenAddress: t2, name: "High", symbol: "HIGH", launchTime, poolId: "0xcc", hookAddress: "0xdd", feeTier: 8388608, tickSpacing: 200, currency0: "", currency1: "", blockNumber: 2, transactionHash: "0x", tokenImage: "", tokenMetadata: "", decimals: 18, totalSupply: "0" },
    { tokenAddress: t3, name: "Mid", symbol: "MID", launchTime, poolId: "0xee", hookAddress: "0xff", feeTier: 8388608, tickSpacing: 200, currency0: "", currency1: "", blockNumber: 3, transactionHash: "0x", tokenImage: "", tokenMetadata: "", decimals: 18, totalSupply: "0" },
  ];
  return { lastUpdated: now, tokens, recentLaunches };
}

beforeAll(() => {
  registerAllNodes();
});

describe("ClankerLaunchSummaryNode", () => {
  it("selects X tokens launched in the past hour, sorted by top volume, with 1m/5m/15m/30m/1h volume and price fields", () => {
    const state = makeFixtureState();
    const nodeData: NodeData = {
      id: "launch-summary",
      type: "clanker_launch_summary",
      inputs: {
        state,
        window_hours: 1,
        limit: 2,
      },
      metadata: {},
      position: { x: 0, y: 0 },
    };
    const node = new ClankerLaunchSummaryNode("launch-summary", nodeData);
    const context: ExecutionContext = {
      variables: {},
      nodeOutputs: {},
    };
    const out = node.execute(context) as {
      recent_launches: Record<string, unknown>[];
      count: number;
      summary: string;
    };
    expect(out.count).toBeLessThanOrEqual(2);
    expect(out.recent_launches).toHaveLength(out.count);

    // All launches must be in past 1h (fixture launchTime is 30 min ago)
    const cutoff = now - ONE_HOUR_MS;
    for (const launch of out.recent_launches) {
      const lt = Number(launch.launchTime ?? 0);
      expect(lt).toBeGreaterThanOrEqual(cutoff);
    }

    // Sorted by top volume (1h then 24h): HIGH (200), then MID (80). LOW (10) excluded by limit 2
    const vols = out.recent_launches.map((l) => Number(l.volume1h ?? 0));
    for (let i = 1; i < vols.length; i++) {
      expect(vols[i]).toBeLessThanOrEqual(vols[i - 1]);
    }
    expect(out.recent_launches[0].symbol).toBe("HIGH");
    expect(out.recent_launches[1].symbol).toBe("MID");

    // Each launch has volume and price movement for 1m, 5m, 15m, 30m, 1h
    for (const launch of out.recent_launches) {
      for (const key of VOLUME_PRICE_KEYS) {
        expect(launch).toHaveProperty(key);
        expect(typeof launch[key]).toBe("number");
      }
    }

    expect(out.summary).toContain("Recent Clanker launches");
    expect(out.summary).toContain("vol1m=");
    expect(out.summary).toContain("priceChange1m=");
    expect(out.summary).toContain("priceChange5m=");
    expect(out.summary).toContain("priceChange1h=");
  });
});
