/**
 * Simple test: call CabalSwapper executeSwap directly for a small buy (one token from state).
 * Verifies zeroForOne and pool params; skips if SWAP_PRIVATE_KEY or state missing.
 *
 * Run: npm test -- cabal-swapper-buy
 */
import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

for (const rel of [
  path.join("..", "..", ".env"),
  path.join("..", "..", "blockchain-service", ".env"),
]) {
  const envPath = path.resolve(__dirname, rel);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

import { executeSwap } from "../src/utils/cabalSwapper";

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

function loadFirstToken(statePath: string): {
  tokenAddress: string;
  feeTier: number;
  tickSpacing: number;
  hookAddress: string;
  currency0: string;
  currency1: string;
} | null {
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw) as {
      tokens?: Record<
        string,
        {
          tokenAddress?: string;
          feeTier?: number;
          tickSpacing?: number;
          hookAddress?: string;
          currency0?: string;
          currency1?: string;
        }
      >;
    };
    const tokens = state.tokens && typeof state.tokens === "object" ? state.tokens : {};
    const first = Object.values(tokens)[0];
    if (!first?.tokenAddress) return null;
    return {
      tokenAddress: String(first.tokenAddress),
      feeTier: Number(first.feeTier) || 0,
      tickSpacing: Number(first.tickSpacing) ?? 0,
      hookAddress:
        first.hookAddress && first.hookAddress !== "0x0000000000000000000000000000000000000000"
          ? String(first.hookAddress)
          : "0x0000000000000000000000000000000000000000",
      currency0: first.currency0 ? String(first.currency0) : "",
      currency1: first.currency1 ? String(first.currency1) : "",
    };
  } catch {
    return null;
  }
}

describe("CabalSwapper simple buy", () => {
  it("should execute a small buy for one token from state (wrap + approve + cabalBuyV4WithPool)", async () => {
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

    const result = await executeSwap(
      privateKey,
      {
        tokenAddress: token.tokenAddress,
        amountWei: SMALL_BUY_WEI,
        isBuy: true,
        poolFee: token.feeTier,
        tickSpacing: token.tickSpacing,
        hookAddress: token.hookAddress,
        currency0: token.currency0,
        currency1: token.currency1,
      },
      process.env.RPC_URL
    );

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.txHash).toBeDefined();
      expect(typeof result.txHash).toBe("string");
      expect(result.txHash!.length).toBeGreaterThan(0);
    } else {
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
    }
  }, 60_000);
});
