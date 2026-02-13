/**
 * Test: buy a small amount of a Clanker token, then approve and sell all received tokens.
 * Ensures the full buy -> sell flow works (approve then cabalSellV4WithPool).
 *
 * Run: npm test -- cabal-swapper-sell
 */
import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

for (const rel of [
  path.join("..", "..", ".env"),
  path.join("..", "..", "blockchain-service", ".env"),
]) {
  const envPath = path.resolve(__dirname, rel);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

import { executeSwap } from "../src/utils/cabalSwapper";

const SMALL_BUY_WEI = "1000000000000"; // 0.000001 ETH
const BASE_CHAIN_ID = 8453;

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
] as const;

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

describe("CabalSwapper buy then sell", () => {
  it("should buy small amount then approve and sell all tokens", async () => {
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

    const rpcUrl = process.env.RPC_URL || "https://mainnet.base.org";
    const provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID, { staticNetwork: true });
    const wallet = new ethers.Wallet(privateKey, provider);

    // 1. Buy
    const buyResult = await executeSwap(
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
      rpcUrl
    );

    expect(buyResult.success).toBe(true);
    expect(buyResult.txHash).toBeDefined();

    // 2. Wait one block so sell isn’t same-block as buy (some hooks/pools or Permit2 care)
    const blockBefore = await provider.getBlockNumber();
    await new Promise<void>((resolve) => {
      const check = async () => {
        const now = await provider.getBlockNumber();
        if (now > blockBefore) return resolve();
        setTimeout(check, 2000);
      };
      check();
    });

    // 3. Get token balance (sell all we just bought)
    const tokenContract = new ethers.Contract(token.tokenAddress, ERC20_ABI as any, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    if (balance === 0n) {
      console.warn("Skipping sell: token balance is 0 after buy");
      return;
    }

    // 4. Sell (executeSwap does approve then cabalSellV4WithPool)
    const sellResult = await executeSwap(
      privateKey,
      {
        tokenAddress: token.tokenAddress,
        amountWei: balance.toString(),
        isBuy: false,
        poolFee: token.feeTier,
        tickSpacing: token.tickSpacing,
        hookAddress: token.hookAddress,
        currency0: token.currency0,
        currency1: token.currency1,
      },
      rpcUrl
    );

    expect(sellResult).toBeDefined();
    if (!sellResult.success) {
      if (sellResult.txHash) {
        console.error("Sell tx (reverted, trace this):", sellResult.txHash);
      }
      console.error("Sell error:", sellResult.error);
      expect(sellResult.success, sellResult.error ?? "Sell failed").toBe(true);
      return;
    }
    expect(sellResult.txHash).toBeDefined();
    expect(typeof sellResult.txHash).toBe("string");
    expect(sellResult.txHash!.length).toBeGreaterThan(0);
    // Sell proceeds are WETH (Clanker pays WETH)
    const wethReceived = (sellResult as { wethReceived?: string }).wethReceived;
    expect(wethReceived).toBeDefined();
    expect(BigInt(wethReceived!)).toBeGreaterThan(0n);
  }, 90_000);

  it("should buy, sell exact tokens from receipt, and leave zero balance", async () => {
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

    const rpcUrl = process.env.RPC_URL || "https://mainnet.base.org";
    const provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID, { staticNetwork: true });
    const wallet = new ethers.Wallet(privateKey, provider);
    const tokenContract = new ethers.Contract(token.tokenAddress, ERC20_ABI as any, provider);

    // 1. Buy
    const buyResult = await executeSwap(
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
      rpcUrl
    );

    expect(buyResult.success).toBe(true);
    expect(buyResult.txHash).toBeDefined();
    expect(buyResult.tokensReceived).toBeDefined();
    expect(BigInt(buyResult.tokensReceived!)).toBeGreaterThan(0n);

    // 2. Wait one block
    const blockBefore = await provider.getBlockNumber();
    await new Promise<void>((resolve) => {
      const check = async () => {
        const now = await provider.getBlockNumber();
        if (now > blockBefore) return resolve();
        setTimeout(check, 2000);
      };
      check();
    });

    // 3. Sell exactly the amount we received from the buy receipt (no balanceOf)
    const tokensToSell = buyResult.tokensReceived!;
    const sellResult = await executeSwap(
      privateKey,
      {
        tokenAddress: token.tokenAddress,
        amountWei: tokensToSell,
        isBuy: false,
        poolFee: token.feeTier,
        tickSpacing: token.tickSpacing,
        hookAddress: token.hookAddress,
        currency0: token.currency0,
        currency1: token.currency1,
      },
      rpcUrl
    );

    expect(sellResult.success, sellResult.error ?? "Sell failed").toBe(true);
    expect(sellResult.txHash).toBeDefined();
    const wethReceived = (sellResult as { wethReceived?: string }).wethReceived;
    expect(wethReceived).toBeDefined();
    expect(BigInt(wethReceived!)).toBeGreaterThan(0n);

    // 4. Assert no tokens left
    const balanceAfter = await tokenContract.balanceOf(wallet.address);
    expect(balanceAfter).toBe(0n);
  }, 90_000);
});
