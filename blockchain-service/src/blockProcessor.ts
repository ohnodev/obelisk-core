/**
 * Poll Base for new blocks; scan receipts for V4 Initialize (Clanker hook) and V4 Swap (tracked pools only).
 * Uses static network (no detection retries), exponential backoff on 429, and throttled catch-up like base-swap-tracker.
 */
import { ethers } from "ethers";
import {
  POOL_MANAGER,
  WETH,
  V4_INITIALIZE_TOPIC,
  UNIV4_SWAP_TOPIC,
  BLOCK_POLL_MS,
} from "./constants.js";
import type { LaunchEvent } from "./types.js";
import { StateManager } from "./state.js";

const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const BASE_CHAIN_ID = 8453;
const MAX_BLOCKS_PER_LOOP = 5;
const RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000;

export class BlockProcessor {
  private provider: ethers.JsonRpcProvider;
  private state: StateManager;
  private clankerHookAddress: string;
  private lastBlockNumber = 0;
  private isRunning = false;
  private retryDelayMs = RETRY_DELAY_MS;

  constructor(
    rpcUrl: string,
    state: StateManager,
    clankerHookAddress: string
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID, {
      staticNetwork: true,
    });
    this.state = state;
    this.clankerHookAddress = clankerHookAddress.toLowerCase();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.initBlockWithRetry();
    this.runLoop();
  }

  stop(): void {
    this.isRunning = false;
  }

  private async initBlockWithRetry(): Promise<void> {
    while (this.isRunning) {
      try {
        this.lastBlockNumber = await this.provider.getBlockNumber();
        console.log(`[Clanker] Starting from block ${this.lastBlockNumber}`);
        this.retryDelayMs = RETRY_DELAY_MS;
        return;
      } catch (e) {
        console.warn("[Clanker] Failed to get initial block:", e);
        await this.sleep(this.retryDelayMs);
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private isRateLimitError(e: unknown): boolean {
    const err = e as { error?: { code?: number }; code?: string };
    return err?.error?.code === 429 || err?.code === "UNKNOWN_ERROR";
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const current = await this.provider.getBlockNumber();
        if (current > this.lastBlockNumber) {
          const from = this.lastBlockNumber + 1;
          const to = Math.min(current, from + MAX_BLOCKS_PER_LOOP - 1);
          for (let b = from; b <= to; b++) {
            await this.processBlock(b);
            await this.sleep(100);
          }
          this.lastBlockNumber = to;
          this.retryDelayMs = RETRY_DELAY_MS;
        } else {
          await this.sleep(BLOCK_POLL_MS);
        }
      } catch (e) {
        console.warn("[Clanker] Block loop error:", e);
        if (this.isRateLimitError(e)) {
          await this.sleep(this.retryDelayMs);
          this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
        } else {
          await this.sleep(BLOCK_POLL_MS);
        }
      }
    }
  }

  private async processBlock(blockNumber: number): Promise<void> {
    const blockHex = "0x" + blockNumber.toString(16);
    const receipts = await this.provider.send("eth_getBlockReceipts", [
      blockHex,
    ] as [string]);
    if (!Array.isArray(receipts) || receipts.length === 0) return;

    const trackedPoolIds = this.state.getTrackedPoolIds();

    for (const receipt of receipts) {
      if (!receipt?.logs?.length) continue;
      for (const log of receipt.logs) {
        const addr = (log as any).address?.toLowerCase?.() ?? String(log.address).toLowerCase();
        const topic0 = (log as any).topics?.[0] ?? (log as any).topics?.[0];

        if (addr === POOL_MANAGER && topic0 === V4_INITIALIZE_TOPIC) {
          const launch = this.parseInitialize(log as any, receipt as any);
          if (launch && launch.hookAddress.toLowerCase() === this.clankerHookAddress) {
            this.state.addLaunch(launch);
            this.state.persist();
            console.log(`[Clanker] New pool: ${launch.tokenAddress} (poolId ${launch.poolId.slice(0, 18)}...)`);
          }
        } else if (topic0 === UNIV4_SWAP_TOPIC) {
          const poolId = (log as any).topics?.[1];
          if (poolId && trackedPoolIds.has(poolId.toLowerCase())) {
            this.processV4Swap(log as any, receipt as any, blockNumber);
          }
        }
      }
    }
  }

  private parseInitialize(
    log: { topics: string[]; data: string },
    receipt: { blockNumber: number | bigint; transactionHash: string }
  ): LaunchEvent | null {
    try {
      const poolId = log.topics[1];
      const t2 = log.topics[2];
      const t3 = log.topics[3];
      const currency0 = ethers.getAddress("0x" + (t2.length === 66 ? t2.slice(26) : t2.slice(-40)));
      const currency1 = ethers.getAddress("0x" + (t3.length === 66 ? t3.slice(26) : t3.slice(-40)));
      const decoded = abiCoder.decode(
        ["uint24", "int24", "address", "uint160", "int24"],
        log.data
      );
      const fee = Number(decoded[0]);
      const tickSpacing = Number(decoded[1]);
      const hooks = String(decoded[2]).toLowerCase();
      const tokenAddress =
        currency0.toLowerCase() === WETH ? currency1 : currency0;
      return {
        tokenAddress: tokenAddress.toLowerCase(),
        currency0: currency0.toLowerCase(),
        currency1: currency1.toLowerCase(),
        poolId,
        hookAddress: hooks,
        feeTier: fee,
        tickSpacing,
        launchTime: Date.now(),
        blockNumber: Number(receipt.blockNumber),
        transactionHash: String(receipt.transactionHash),
      };
    } catch (e) {
      console.warn("[Clanker] Parse Initialize error:", e);
      return null;
    }
  }

  private processV4Swap(
    log: { topics: string[]; data: string },
    receipt: { blockNumber: number },
    blockNumber: number
  ): void {
    try {
      const poolId = log.topics[1];
      const decoded = abiCoder.decode(
        ["int256", "int256", "uint160", "uint128", "int24", "uint24"],
        log.data
      );
      const amount0 = BigInt(decoded[0].toString());
      const amount1 = BigInt(decoded[1].toString());

      const token = this.getTokenByPoolId(poolId);
      if (!token) return;

      const isBuy =
        (token.currency0 === WETH && amount0 < 0n) ||
        (token.currency1 === WETH && amount1 < 0n);
      const side = isBuy ? "buy" as const : "sell" as const;
      const amount0Abs = amount0 < 0n ? -amount0 : amount0;
      const amount1Abs = amount1 < 0n ? -amount1 : amount1;
      const volumeUsd = 0; // Optional: could resolve price for USD; for now just count
      this.state.recordSwap(poolId, side, volumeUsd, Date.now());
    } catch (e) {
      console.warn("[Clanker] Process V4 swap error:", e);
    }
  }

  private getTokenByPoolId(poolId: string): { currency0: string; currency1: string } | null {
    const id = poolId.toLowerCase();
    for (const t of Object.values(this.state.getState().tokens)) {
      if (t.poolId.toLowerCase() === id) return t;
    }
    return null;
  }
}
