/**
 * Unit test: ClankerLaunchSummaryNode selects tokens launched in the past hour,
 * sorted by top volume, with 1m/5m/15m/30m/1h volume and price movement fields.
 * Also tests formatHoldingsSummary for portfolio-aware LLM context.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ClankerLaunchSummaryNode, formatHoldingsSummary } from "../src/core/execution/nodes/clankerLaunchSummary";
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

    expect(out.summary).toContain("Top 2 Clanker candidates");
    expect(out.summary).toContain("Current Holdings: none");
    expect(out.summary).toContain("vol1m=");
    expect(out.summary).toContain("priceChange1m=");
    expect(out.summary).toContain("priceChange5m=");
    expect(out.summary).toContain("priceChange1h=");
  });
});

describe("formatHoldingsSummary", () => {
  it("returns 'none' when there are no holdings", () => {
    const result = formatHoldingsSummary([], {}, Date.now());
    expect(result).toBe("Current Holdings: none\n");
  });

  it("formats a single holding with correct P&L", () => {
    const now = Date.now();
    const holdings = [
      {
        address: "0xaaa",
        boughtAtPriceEth: 0.0001,
        boughtAtTimestamp: now - 5 * 60_000, // 5 min ago
        amountWei: "1000000000000000000",
      },
    ];
    const tokens: Record<string, Record<string, unknown>> = {
      "0xaaa": { name: "TestToken", symbol: "TST", lastPrice: 0.00015 },
    };
    const result = formatHoldingsSummary(holdings, tokens, now);

    expect(result).toContain("Current Holdings (1 position):");
    expect(result).toContain("TestToken (TST)");
    expect(result).toContain("bought 0.00010000 ETH");
    expect(result).toContain("now 0.00015000 ETH");
    expect(result).toContain("+50.0%");
    expect(result).toContain("held 5m");
  });

  it("formats negative P&L correctly", () => {
    const now = Date.now();
    const holdings = [
      {
        address: "0xbbb",
        boughtAtPriceEth: 0.0002,
        boughtAtTimestamp: now - 90 * 60_000, // 1h30m ago
        amountWei: "500000000000000000",
      },
    ];
    const tokens: Record<string, Record<string, unknown>> = {
      "0xbbb": { name: "Loser", symbol: "LOSE", lastPrice: 0.0001 },
    };
    const result = formatHoldingsSummary(holdings, tokens, now);

    expect(result).toContain("Current Holdings (1 position):");
    expect(result).toContain("-50.0%");
    expect(result).toContain("held 1h30m");
  });

  it("formats multiple holdings with plural label", () => {
    const now = Date.now();
    const holdings = [
      {
        address: "0xaaa",
        boughtAtPriceEth: 0.0001,
        boughtAtTimestamp: now - 3 * 60_000,
        amountWei: "1000000000000000000",
      },
      {
        address: "0xbbb",
        boughtAtPriceEth: 0.0002,
        boughtAtTimestamp: now - 10 * 60_000,
        amountWei: "500000000000000000",
      },
    ];
    const tokens: Record<string, Record<string, unknown>> = {
      "0xaaa": { name: "Alpha", symbol: "ALPH", lastPrice: 0.00012 },
      "0xbbb": { name: "Beta", symbol: "BETA", lastPrice: 0.00018 },
    };
    const result = formatHoldingsSummary(holdings, tokens, now);

    expect(result).toContain("Current Holdings (2 positions):");
    expect(result).toContain("Alpha (ALPH)");
    expect(result).toContain("Beta (BETA)");
  });

  it("handles missing token data gracefully", () => {
    const now = Date.now();
    const holdings = [
      {
        address: "0xunknown",
        boughtAtPriceEth: 0.0001,
        boughtAtTimestamp: now - 2 * 60_000,
        amountWei: "1000000000000000000",
      },
    ];
    const result = formatHoldingsSummary(holdings, {}, now);

    expect(result).toContain("Current Holdings (1 position):");
    // Falls back to truncated address
    expect(result).toContain("0xunknown");
    expect(result).toContain("now 0.00000000 ETH");
    // With 0 current price and 0.0001 buy price => -100% P&L
    expect(result).toContain("-100.0%");
  });
});
