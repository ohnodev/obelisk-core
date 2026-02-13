/**
 * Poll Base for new blocks; scan receipts for V4 Initialize (Clanker hook) and V4 Swap (tracked pools only).
 */
import { ethers } from "ethers";
import {
  POOL_MANAGER,
  WETH,
  CLANKER_FACTORY,
  V4_INITIALIZE_TOPIC,
  UNIV4_SWAP_TOPIC,
  TOKEN_CREATED_TOPIC,
  GOD_MULTICALL_ADDRESS,
  GOD_MULTICALL_V4_ABI,
  BLOCK_POLL_MS,
} from "./constants.js";
import type { LaunchEvent } from "./types.js";

/** Parsed Initialize event (no TokenCreated or GodMulticall fields). */
type InitializeCandidate = Omit<
  LaunchEvent,
  "name" | "symbol" | "tokenImage" | "tokenMetadata" | "decimals" | "totalSupply"
>;
/** Launch with TokenCreated data; we only add to state after GodMulticall returns valid decimals/totalSupply */
type PendingLaunch = Omit<LaunchEvent, "decimals" | "totalSupply">;
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
  /** Blocks currently being processed; concurrent attempts for the same block wait on this and then return. */
  private readonly inFlightBlocks = new Map<number, { promise: Promise<void>; resolve: () => void }>();

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
    const existing = this.inFlightBlocks.get(blockNumber);
    if (existing) {
      await existing.promise;
      return;
    }

    let blockErrors = 0;
    while (this.isRunning) {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      let resolveInFlight: (() => void) | undefined;
      const inFlightPromise = new Promise<void>((r) => {
        resolveInFlight = r;
      });
      this.inFlightBlocks.set(blockNumber, { promise: inFlightPromise, resolve: resolveInFlight! });

      const workPromise = this.processBlock(blockNumber);
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => reject(new Error(`Block ${blockNumber} timeout after ${BLOCK_PROCESS_TIMEOUT_MS / 1000}s`)),
            BLOCK_PROCESS_TIMEOUT_MS
          );
        });
        await Promise.race([workPromise, timeoutPromise]);
        this.consecutiveErrors = 0;
        this.retryDelayMs = RETRY_DELAY_MS;
        return;
      } catch (e) {
        blockErrors++;
        this.consecutiveErrors++;
        console.warn(`[Clanker] Error processing block ${blockNumber} (${this.consecutiveErrors}):`, e);
        if (blockErrors > 3) return;
        await workPromise.catch(() => {});
        await this.sleep(this.retryDelayMs);
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
        if (this.consecutiveErrors % 5 === 0) {
          console.warn("[Clanker] Recreating provider after persistent errors");
          this.recreateProvider();
        }
      } finally {
        if (timerId !== undefined) clearTimeout(timerId);
        resolveInFlight?.();
        this.inFlightBlocks.delete(blockNumber);
      }
    }
  }

  private async handleMainLoopError(error: unknown): Promise<void> {
    this.consecutiveErrors++;
    console.warn(`[Clanker] Main loop error (${this.consecutiveErrors}):`, error);
    if (this.consecutiveErrors > 10) {
      try {
        const recent = await this.getCurrentBlockWithRetry();
        this.lastBlockNumber = Math.max(0, recent - 10);
        console.warn(`[Clanker] Reset to block ${this.lastBlockNumber}`);
        this.consecutiveErrors = 0;
        this.retryDelayMs = RETRY_DELAY_MS;
      } catch {
        // ignore
      }
    }
    await this.sleep(this.retryDelayMs);
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    if (this.consecutiveErrors % 5 === 0) this.recreateProvider();
  }

  private async processBlock(blockNumber: number): Promise<void> {
    const blockHex = "0x" + blockNumber.toString(16);
    const receipts = await this.provider.send("eth_getBlockReceipts", [blockHex] as [string]);
    if (!Array.isArray(receipts) || receipts.length === 0) return;

    const trackedPoolIds = this.state.getTrackedPoolIds();
    const pendingLaunches: PendingLaunch[] = [];
    const pendingPoolIdKeys = new Set<string>();
    const swapsToProcess: { log: any; receipt: any; blockNumber: number }[] = [];

    for (const receipt of receipts) {
      if (!receipt?.logs?.length) continue;

      const tokenCreatedByPoolId = this.collectTokenCreatedInReceipt(receipt);

      for (const log of receipt.logs) {
        const addr = (log as any).address?.toLowerCase?.() ?? String(log.address).toLowerCase();
        const topic0 = (log as any).topics?.[0] ?? (log as any).topics?.[0];

        if (addr === POOL_MANAGER && topic0 === V4_INITIALIZE_TOPIC) {
          const candidate = this.parseInitialize(log as any, receipt as any);
          if (!candidate || candidate.hookAddress.toLowerCase() !== this.clankerHookAddress) continue;
          const poolIdKey = this.normalizePoolId(candidate.poolId);
          const tokenCreated = tokenCreatedByPoolId.get(poolIdKey);
          if (!tokenCreated) continue; // proper Clanker deployment always has TokenCreated in same tx — skip to avoid false positives
          const pending: PendingLaunch = {
            ...candidate,
            name: tokenCreated.tokenName,
            symbol: tokenCreated.tokenSymbol,
            tokenImage: tokenCreated.tokenImage,
            tokenMetadata: tokenCreated.tokenMetadata,
          };
          pendingLaunches.push(pending);
          pendingPoolIdKeys.add(poolIdKey);
        } else if (topic0 === UNIV4_SWAP_TOPIC) {
          const poolId = (log as any).topics?.[1];
          const poolIdKey = poolId ? this.normalizePoolId(poolId) : "";
          if (poolIdKey && (trackedPoolIds.has(poolIdKey) || pendingPoolIdKeys.has(poolIdKey))) {
            swapsToProcess.push({ log, receipt, blockNumber });
          }
        }
      }
    }

    // Only add launches when GodMulticall returns valid decimals + totalSupply (required; no partial state)
    if (pendingLaunches.length > 0) {
      const added = await this.resolvePendingLaunchesWithGodMulticall(pendingLaunches);
      if (added > 0) {
        this.state.persist();
      }
      if (added < pendingLaunches.length && pendingLaunches.length > 0) {
        console.warn(
          `[Clanker] GodMulticall: ${pendingLaunches.length - added} pool(s) skipped (no valid decimals/totalSupply)`
        );
      }
    }

    for (const { log, receipt, blockNumber: bn } of swapsToProcess) {
      this.processV4Swap(log, receipt, bn);
    }
    if (swapsToProcess.length > 0 && pendingLaunches.length === 0) {
      this.state.persist();
    }
  }

  /** One RPC: GodMulticall. Only addLaunch when we have valid decimals + totalSupply (required). */
  private async resolvePendingLaunchesWithGodMulticall(pending: PendingLaunch[]): Promise<number> {
    if (pending.length === 0) return 0;
    try {
      const godMulticall = new ethers.Contract(
        GOD_MULTICALL_ADDRESS,
        GOD_MULTICALL_V4_ABI,
        this.provider
      );
      const poolIds = pending.map((l) => l.poolId);
      const results = await godMulticall.batchGetCompleteV4PoolInfo(poolIds);
      let added = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r?.success) continue;
        const tokenAddress = pending[i].tokenAddress.toLowerCase();
        const token0Lower = String(r.token0 ?? "").toLowerCase();
        const token1Lower = String(r.token1 ?? "").toLowerCase();
        const isToken0 = token0Lower === tokenAddress;
        const details = isToken0 ? r.token0Details : r.token1Details;
        if (!details?.success) continue;
        const decimals = Number(details.decimals);
        if (Number.isNaN(decimals) || decimals < 0 || decimals > 255) continue;
        const totalSupply =
          details.totalSupply != null && details.totalSupply !== undefined
            ? String(details.totalSupply)
            : "0";
        const launch: LaunchEvent = {
          ...pending[i],
          decimals,
          totalSupply,
        };
        this.state.addLaunch(launch);
        added++;
        console.log(
          `[Clanker] New pool: ${launch.tokenAddress} (${launch.symbol}) decimals=${decimals} (poolId ${launch.poolId.slice(0, 18)}...)`
        );
      }
      if (added > 0) {
        console.log(`[Clanker] GodMulticall: ${added} new pool(s) with full token info in 1 RPC call`);
      }
      return added;
    } catch (e) {
      console.warn("[Clanker] GodMulticall batch failed:", e);
      return 0;
    }
  }

  private normalizePoolId(poolId: string): string {
    const hex = poolId.startsWith("0x") ? poolId.slice(2) : poolId;
    return ("0x" + hex).toLowerCase();
  }

  /** TokenCreated data (non-indexed): msgSender, tokenImage, tokenName, tokenSymbol, tokenMetadata, tokenContext, startingTick, poolHook, poolId, pairedToken, locker, mevModule, extensionsSupply, extensions */
  private static TOKEN_CREATED_DATA_TYPES = [
    "address", "string", "string", "string", "string", "string",
    "int24", "address", "bytes32", "address", "address", "address", "uint256", "address[]",
  ] as const;

  private collectTokenCreatedInReceipt(receipt: any): Map<string, { tokenName: string; tokenSymbol: string; tokenImage: string; tokenMetadata: string }> {
    const out = new Map<string, { tokenName: string; tokenSymbol: string; tokenImage: string; tokenMetadata: string }>();
    if (!receipt?.logs?.length) return out;
    for (const log of receipt.logs) {
      const addr = (log as any).address?.toLowerCase?.() ?? String(log.address).toLowerCase();
      const topic0 = (log as any).topics?.[0];
      if (addr !== CLANKER_FACTORY || topic0 !== TOKEN_CREATED_TOPIC) continue;
      try {
        const decoded = abiCoder.decode(
          [...BlockProcessor.TOKEN_CREATED_DATA_TYPES],
          (log as any).data ?? "0x"
        );
        const poolId = decoded[8]; // bytes32 poolId (ethers returns hex string)
        const poolIdKey = this.normalizePoolId(String(poolId ?? ""));
        out.set(poolIdKey, {
          tokenName: String(decoded[2] ?? ""),
          tokenSymbol: String(decoded[3] ?? ""),
          tokenImage: String(decoded[1] ?? ""),
          tokenMetadata: String(decoded[4] ?? ""),
        });
      } catch (e) {
        console.warn("[Clanker] TokenCreated decode error:", e);
      }
    }
    return out;
  }

  private parseInitialize(
    log: { topics: string[]; data: string },
    receipt: { blockNumber: number | bigint; transactionHash: string }
  ): InitializeCandidate | null {
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

      const tokenInfo = this.getTokenByPoolId(poolId);
      if (!tokenInfo) return;

      const isBuy =
        (tokenInfo.currency0 === WETH && amount0 < 0n) ||
        (tokenInfo.currency1 === WETH && amount1 < 0n);
      const side = isBuy ? "buy" as const : "sell" as const;

      const wethAmount = tokenInfo.currency0 === WETH ? amount0 : amount1;
      const tokenAmount = tokenInfo.currency0 === WETH ? amount1 : amount0;
      const wethAbs = wethAmount < 0n ? -wethAmount : wethAmount;
      const volumeEth = Number(wethAbs) / 1e18;

      const tokenAddress = tokenInfo.currency0 === WETH ? tokenInfo.currency1 : tokenInfo.currency0;
      const tokenState = this.state.getToken(tokenAddress);
      const decimals = tokenState?.decimals ?? 18;
      const tokenAmountAbs = tokenAmount < 0n ? -tokenAmount : tokenAmount;
      const priceEth =
        tokenAmountAbs > 0n && volumeEth > 0
          ? volumeEth / (Number(tokenAmountAbs) / Math.pow(10, decimals))
          : undefined;

      this.state.recordSwap(poolId, side, volumeEth, Date.now(), undefined, priceEth);
      console.log(`[Clanker] Swap ${side} on pool ${poolId.slice(0, 18)}... volEth=${volumeEth.toFixed(6)}`);
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
