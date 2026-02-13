/**
 * Integration test: run a minimal workflow that performs a tiny Clanker buy (0.000001 ETH)
 * using SWAP_PRIVATE_KEY and a token from the cached blockchain state.
 *
 * Run with: npm test -- clanker-buy (loads .env from obelisk-core root if present)
 * Skips if SWAP_PRIVATE_KEY is unset or state file has no tokens.
 */
import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// Load .env from obelisk-core root and blockchain-service so SWAP_PRIVATE_KEY is available
for (const rel of [path.join("..", "..", ".env"), path.join("..", "..", "blockchain-service", ".env")]) {
  const envPath = path.resolve(__dirname, rel);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}
import { ethers } from "ethers";
import { ExecutionEngine } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import type { WorkflowData } from "../src/core/types";
import { parseSwapReceiptTokensReceived } from "../src/utils/cabalSwapper";

const SMALL_BUY_WEI = "1000000000000"; // 0.000001 ETH
const BUY_10_GWEI_WEI = "10000000000000"; // 0.00001 ETH

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

function loadFirstToken(statePath: string): { tokenAddress: string; feeTier: number; tickSpacing: number; hookAddress: string; currency0: string; currency1: string } | null {
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw) as { tokens?: Record<string, { tokenAddress?: string; feeTier?: number; tickSpacing?: number; hookAddress?: string; currency0?: string; currency1?: string }> };
    const tokens = state.tokens && typeof state.tokens === "object" ? state.tokens : {};
    const first = Object.values(tokens)[0];
    if (!first?.tokenAddress) return null;
    return {
      tokenAddress: String(first.tokenAddress),
      feeTier: Number(first.feeTier) || 0,
      tickSpacing: Number(first.tickSpacing) ?? 0,
      hookAddress: first.hookAddress && first.hookAddress !== "0x0000000000000000000000000000000000000000" ? String(first.hookAddress) : "0x0000000000000000000000000000000000000000",
      currency0: first.currency0 ? String(first.currency0) : "",
      currency1: first.currency1 ? String(first.currency1) : "",
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
            currency0: token.currency0,
            currency1: token.currency1,
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

    // Require an actual on-chain tx: workflow ran and ClankerBuy returned success + txHash
    expect(success).toBe(true);
    expect(typeof txHash).toBe("string");
    expect(txHash.length).toBeGreaterThan(0);
    if (error) {
      expect(error).toBe(""); // no error when we expect success
    }
  }, 60_000);

  it("should output tokens received from Swap log (0.00001 ETH buy) and match receipt parse", async () => {
    const privateKey = process.env.SWAP_PRIVATE_KEY?.trim();
    if (!privateKey || privateKey.length < 20) {
      console.warn("Skipping: SWAP_PRIVATE_KEY not set");
      return;
    }

    const statePath = findStatePath();
    if (!statePath) {
      console.warn("Skipping: no clanker_state.json found");
      return;
    }

    const token = loadFirstToken(statePath);
    if (!token) {
      console.warn("Skipping: no tokens in state");
      return;
    }

    const workflow: WorkflowData = {
      id: "clanker-buy-parse-test",
      name: "Clanker buy parse test",
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
            amount_wei: BUY_10_GWEI_WEI,
            token_address: token.tokenAddress,
            pool_fee: token.feeTier,
            tick_spacing: token.tickSpacing,
            hook_address: token.hookAddress,
            currency0: token.currency0,
            currency1: token.currency1,
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
    expect(buyResult?.outputs?.success).toBe(true);
    const txHash = buyResult?.outputs?.txHash as string | undefined;
    const amountWeiFromNode = buyResult?.outputs?.amount_wei as string | undefined;
    expect(typeof txHash).toBe("string");
    expect(txHash!.length).toBeGreaterThan(0);

    const rpcUrl = process.env.RPC_URL ?? "https://mainnet.base.org";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash!);
    expect(receipt).toBeDefined();
    expect(receipt!.logs).toBeDefined();
    expect(receipt!.logs.length).toBeGreaterThan(0);

    const parsed = parseSwapReceiptTokensReceived(
      { logs: receipt!.logs as Array<{ address: string; topics: string[]; data: string }> },
      token.tokenAddress,
      token.currency0,
      token.currency1
    );
    expect(parsed).toBeDefined();
    expect(BigInt(parsed)).toBeGreaterThan(0n);
    expect(amountWeiFromNode).toBe(parsed);
    expect(BigInt(amountWeiFromNode!)).not.toBe(BigInt(BUY_10_GWEI_WEI));
  }, 90_000);
});
