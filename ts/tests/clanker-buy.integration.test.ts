/**
 * Integration test: run a minimal workflow that performs a tiny Clanker buy (0.000001 ETH)
 * using SWAP_PRIVATE_KEY and a token from the cached blockchain state.
 *
 * Run with: SWAP_PRIVATE_KEY=0x... npm test -- clanker-buy
 * Skips if SWAP_PRIVATE_KEY is unset or state file has no tokens.
 */
import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs";
import { ExecutionEngine } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import type { WorkflowData } from "../src/core/types";

const SMALL_BUY_WEI = "1000000000000"; // 0.000001 ETH

function findStatePath(): string | null {
  const candidates = [
    path.join(process.cwd(), "blockchain-service", "data", "clanker_state.json"),
    path.join(process.cwd(), "..", "blockchain-service", "data", "clanker_state.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadFirstToken(statePath: string): { tokenAddress: string; feeTier: number; tickSpacing: number; hookAddress: string } | null {
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw) as { tokens?: Record<string, { tokenAddress?: string; feeTier?: number; tickSpacing?: number; hookAddress?: string }> };
    const tokens = state.tokens && typeof state.tokens === "object" ? state.tokens : {};
    const first = Object.values(tokens)[0];
    if (!first?.tokenAddress) return null;
    return {
      tokenAddress: String(first.tokenAddress),
      feeTier: Number(first.feeTier) || 0,
      tickSpacing: Number(first.tickSpacing) ?? 0,
      hookAddress: first.hookAddress && first.hookAddress !== "0x0000000000000000000000000000000000000000" ? String(first.hookAddress) : "0x0000000000000000000000000000000000000000",
    };
  } catch {
    return null;
  }
}

beforeAll(() => {
  registerAllNodes();
});

const engine = new ExecutionEngine();

describe("Clanker buy integration", () => {
  it("should run Wallet -> ClankerBuy with 0.000001 ETH for a cached token", async () => {
    const privateKey = process.env.SWAP_PRIVATE_KEY?.trim();
    if (!privateKey || privateKey.length < 20) {
      console.warn("Skipping Clanker buy test: SWAP_PRIVATE_KEY not set");
      return;
    }

    const statePath = findStatePath();
    if (!statePath) {
      console.warn("Skipping Clanker buy test: no clanker_state.json found");
      return;
    }

    const token = loadFirstToken(statePath);
    if (!token) {
      console.warn("Skipping Clanker buy test: no tokens in state");
      return;
    }

    const workflow: WorkflowData = {
      id: "clanker-buy-test",
      name: "Clanker buy test",
      nodes: [
        {
          id: "wallet",
          type: "wallet",
          inputs: {},
          metadata: { private_key: "{{process.env.SWAP_PRIVATE_KEY}}" },
        },
        {
          id: "buy",
          type: "clanker_buy",
          inputs: {},
          metadata: {
            amount_wei: SMALL_BUY_WEI,
            token_address: token.tokenAddress,
            pool_fee: token.feeTier,
            tick_spacing: token.tickSpacing,
            hook_address: token.hookAddress,
          },
        },
      ],
      connections: [
        { source_node: "wallet", source_output: "private_key", target_node: "buy", target_input: "private_key" },
      ],
    };

    const result = await engine.execute(workflow, {}, {});

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    const buyResult = result.nodeResults?.find((r) => r.nodeId === "buy");
    expect(buyResult).toBeDefined();
    expect(buyResult?.outputs).toBeDefined();
    const success = buyResult?.outputs?.success as boolean | undefined;
    const txHash = buyResult?.outputs?.txHash as string | undefined;
    const error = buyResult?.outputs?.error as string | undefined;

    if (success && txHash) {
      expect(typeof txHash).toBe("string");
      expect(txHash.length).toBeGreaterThan(0);
    } else {
      expect(typeof (txHash ?? error) === "string").toBe(true);
    }
  }, 60_000);
});
