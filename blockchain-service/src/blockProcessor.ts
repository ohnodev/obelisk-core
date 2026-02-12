/**
 * Poll Base for new blocks; scan receipts for V4 Initialize (Clanker hook) and V4 Swap (tracked pools only).
 * Mirrors base-swap-tracker BlockProcessor: same loop, retries, backfill queue, provider recreation.
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
const RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const BLOCK_PROCESS_TIMEOUT_MS = 60000;

function createProvider(rpcUrl: string): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID, {
    staticNetwork: true,
  });
}

export class BlockProcessor {
  private provider: ethers.JsonRpcProvider;
  private readonly rpcUrl: string;
  private readonly state: StateManager;
  private readonly clankerHookAddress: string;
  private lastBlockNumber = 0;
  private isRunning = false;
  private consecutiveErrors = 0;
  private retryDelayMs = RETRY_DELAY_MS;
  private backfillQueue: number[] = [];

  constructor(
    rpcUrl: string,
    state: StateManager,
    clankerHookAddress: string
  ) {
    this.rpcUrl = rpcUrl;
    this.provider = createProvider(rpcUrl);
    this.state = state;
    this.clankerHookAddress = clankerHookAddress.toLowerCase();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.initializeWithRetry();
    this.runLoop();
  }

  stop(): void {
    this.isRunning = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private recreateProvider(): void {
    this.provider = createProvider(this.rpcUrl);
  }

  private async initializeWithRetry(): Promise<void> {
    while (this.isRunning) {
      try {
        this.lastBlockNumber = await this.provider.getBlockNumber();
        console.log(`[Clanker] Starting from block ${this.lastBlockNumber}`);
        this.consecutiveErrors = 0;
        this.retryDelayMs = RETRY_DELAY_MS;
        return;
      } catch (e) {
        this.consecutiveErrors++;
        console.warn(`[Clanker] Error initializing (${this.consecutiveErrors}):`, e);
        await this.sleep(this.retryDelayMs);
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
        if (this.consecutiveErrors % 5 === 0) {
          console.warn("[Clanker] Recreating provider after persistent errors");
          this.recreateProvider();
        }
      }
    }
  }

  private async getCurrentBlockWithRetry(): Promise<number> {
    const maxRetries = 3;
    let retries = 0;
    while (this.isRunning && retries < maxRetries) {
      try {
        const blockNumber = await this.provider.getBlockNumber();
        this.consecutiveErrors = 0;
        return blockNumber;
      } catch (e) {
        retries++;
        this.consecutiveErrors++;
        console.warn(`[Clanker] Error getting block (${this.consecutiveErrors}):`, e);
        if (retries < maxRetries) {
          await this.sleep(this.retryDelayMs);
          this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
          if (this.consecutiveErrors % 5 === 0) {
            console.warn("[Clanker] Recreating provider after persistent errors");
            this.recreateProvider();
          }
        }
      }
    }
    console.warn(`[Clanker] Using last known block ${this.lastBlockNumber} after ${maxRetries} retries`);
    return this.lastBlockNumber;
  }

  private async runLoop(): Promise<void> {
    let noNewBlocksCount = 0;
    while (this.isRunning) {
      try {
        const current = await this.getCurrentBlockWithRetry();
        if (current > this.lastBlockNumber) {
          const blocksToProcess = current - this.lastBlockNumber;
          if (blocksToProcess > 0) {
            await this.processBlockRangeWithRetry(this.lastBlockNumber + 1, current);
            this.lastBlockNumber = current;
            this.consecutiveErrors = 0;
            this.retryDelayMs = RETRY_DELAY_MS;
            noNewBlocksCount = 0;
          }
        } else {
          noNewBlocksCount++;
          if (noNewBlocksCount % 5 === 1) {
            console.warn(`[Clanker] Waiting for new blocks... current ${current} (${noNewBlocksCount}s)`);
          }
        }
        await this.sleep(BLOCK_POLL_MS);
      } catch (e) {
        await this.handleMainLoopError(e);
      }
    }
  }

  private async processBlockRangeWithRetry(startBlock: number, endBlock: number): Promise<void> {
    const count = endBlock - startBlock + 1;
    for (let b = startBlock; b <= endBlock; b++) {
      await this.processBlockWithRetry(b);
    }
  }

  private async processBlockWithRetry(blockNumber: number): Promise<void> {
    let blockErrors = 0;
    while (this.isRunning) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Block ${blockNumber} timeout after ${BLOCK_PROCESS_TIMEOUT_MS / 1000}s`)), BLOCK_PROCESS_TIMEOUT_MS);
        });
        await Promise.race([this.processBlock(blockNumber), timeoutPromise]);
        this.consecutiveErrors = 0;
        this.retryDelayMs = RETRY_DELAY_MS;
        return;
      } catch (e) {
        blockErrors++;
        this.consecutiveErrors++;
        console.warn(`[Clanker] Error processing block ${blockNumber} (${this.consecutiveErrors}):`, e);
        if (blockErrors > 3) {
          if (!this.backfillQueue.includes(blockNumber)) {
            this.backfillQueue.push(blockNumber);
          }
          return;
        }
        await this.sleep(this.retryDelayMs);
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
        if (this.consecutiveErrors % 5 === 0) {
          console.warn("[Clanker] Recreating provider after persistent errors");
          this.recreateProvider();
        }
      }
    }
  }

  private async handleMainLoopError(error: unknown): Promise<void> {
    this.consecutiveErrors++;
    console.warn(`[Clanker] Main loop error (${this.consecutiveErrors}):`, error);
    if (this.backfillQueue.length > 0) {
      const toBackfill = [...this.backfillQueue];
      this.backfillQueue = [];
      for (const blockNum of toBackfill) {
        await this.processBlockWithRetry(blockNum);
      }
    }
    if (this.consecutiveErrors > 10) {
      try {
        const recent = await this.getCurrentBlockWithRetry();
        this.lastBlockNumber = Math.max(0, recent - 10);
        console.warn(`[Clanker] Reset to block ${this.lastBlockNumber} (recent ${recent})`);
        this.consecutiveErrors = 0;
        this.retryDelayMs = RETRY_DELAY_MS;
      } catch (e) {
        console.warn("[Clanker] Failed to reset to recent block:", e);
      }
    }
    await this.sleep(this.retryDelayMs);
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    if (this.consecutiveErrors % 5 === 0) {
      console.warn("[Clanker] Recreating provider after persistent errors");
      this.recreateProvider();
    }
  }

  private async processBlock(blockNumber: number): Promise<void> {
    const blockHex = "0x" + blockNumber.toString(16);
    const receipts = await this.provider.send("eth_getBlockReceipts", [blockHex] as [string]);
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
      const volumeUsd = 0;
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
