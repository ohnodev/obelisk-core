/**
 * Transaction service for sending on-chain txs with proper gas, timeouts, nonce recovery,
 * and error handling. Single-signer (user wallet) for Polymarket.
 * Adapted from basemarket transactionFacilitator.
 */

import { ethers } from 'ethers';
import {
  POLYGON_GAS_TIP_GWEI,
  POLYGON_GAS_MAX_FEE_GWEI,
} from '../config.js';

const LABEL = 'TxService';
const GAS_STATION_URL = 'https://gasstation.polygon.technology/v2';
const REPLACEMENT_BUMP_PERCENT = 200; // 2x gas on replacement (was 1.12x)
const TX_WAIT_TIMEOUT_MS = 30_000; // 30s per attempt; send replacement with 2x gas if no receipt
const RECEIPT_POLL_INTERVAL_MS = 250;
const FINAL_POLL_WINDOW_MS = 60_000;
const NONCE_RECOVERY_GAS_LIMIT = 21_000;

type FeeOverrides = {
  gasPrice?: ethers.BigNumber;
  maxFeePerGas?: ethers.BigNumber;
  maxPriorityFeePerGas?: ethers.BigNumber;
};

export interface ExecuteParams {
  contractAddress: string;
  contractAbi: string | ethers.ContractInterface;
  method: string;
  args: unknown[];
  gasLimit?: ethers.BigNumber;
  value?: ethers.BigNumber;
  timeoutMs?: number;
}

export interface ExecutionResult {
  txHash: string;
  receipt: ethers.ContractReceipt;
}

function errorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return String(error).toLowerCase();
  }
  const details = error as { code?: string; shortMessage?: string; message?: string };
  return `${details.code ?? ''} ${details.shortMessage ?? ''} ${details.message ?? ''}`.toLowerCase();
}

function multiplyFee(value: ethers.BigNumber, numerator: number, denominator = 100): ethers.BigNumber {
  return value.mul(numerator).div(denominator);
}

function maxDefinedFee(
  a: ethers.BigNumber | undefined,
  b: ethers.BigNumber | undefined,
): ethers.BigNumber | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.gt(b) ? a : b;
}

function uniqueHashes(input: string[]): string[] {
  return [...new Set(input.filter((h) => h.length > 0))];
}

export function isGasPriceError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('gas price below minimum') ||
    lower.includes('gas tip cap') ||
    lower.includes('maxfeepergas') ||
    lower.includes('max priority fee')
  );
}

export function isNoPositionError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('execution reverted') ||
    lower.includes('nothing to redeem') ||
    lower.includes('cannot estimate gas') ||
    lower.includes('unpredictable_gas_limit') ||
    lower.includes('transaction may fail')
  );
}

function isRecoverableSendError(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('timeout') ||
    text.includes('replacement transaction underpriced') ||
    text.includes('nonce too low') ||
    text.includes('nonce too high') ||
    text.includes('nonce has already been used') ||
    text.includes('already known') ||
    text.includes('temporarily underpriced') ||
    text.includes('gas price below minimum')
  );
}

export class TransactionService {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly signer: ethers.Wallet;
  private queueTail: Promise<void> = Promise.resolve();

  constructor(params: { provider: ethers.providers.JsonRpcProvider; signer: ethers.Wallet }) {
    this.provider = params.provider;
    this.signer = params.signer;
  }

  async execute(params: ExecuteParams): Promise<ExecutionResult> {
    return this.enqueue(() => this.executeInternal(params));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(task, task);
    this.queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async executeInternal(params: ExecuteParams): Promise<ExecutionResult> {
    const pendingHashes: string[] = [];
    const timeoutMs = params.timeoutMs ?? TX_WAIT_TIMEOUT_MS;

    try {
      return await this.attemptWithSigner(params, pendingHashes, timeoutMs);
    } catch (error) {
      const isTimeout = errorText(error).includes('tx timed out');
      if (isTimeout) {
        console.warn(`[${LABEL}] Tx timed out, resetting stuck nonce…`);
        await this.resetStuckNonces().catch((e) => console.warn(`[${LABEL}] nonce reset failed:`, e));
      } else if (isRecoverableSendError(error)) {
        console.warn(`[${LABEL}] recoverable send error, attempting nonce recovery:`, errorText(error));
        await this.resetStuckNonces().catch((e) => console.warn(`[${LABEL}] nonce reset failed:`, e));
      }
      const finalReceipt = await this.pollPendingHashes(pendingHashes, FINAL_POLL_WINDOW_MS);
      if (finalReceipt) {
        this.assertSucceeded(finalReceipt);
        return {
          txHash: finalReceipt.transactionHash,
          receipt: finalReceipt as ethers.ContractReceipt,
        };
      }
      throw error;
    }
  }

  private async attemptWithSigner(
    params: ExecuteParams,
    pendingHashes: string[],
    timeoutMs: number,
  ): Promise<ExecutionResult> {
    const nonce = await this.provider.getTransactionCount(this.signer.address, 'pending');
    const baseFees = await this.getFeeOverrides();
    const firstTx = await this.sendContractTx(params, nonce, baseFees);
    pendingHashes.push(firstTx.hash);
    console.log(`[${LABEL}] Tx broadcast hash=${firstTx.hash}, waiting for confirmation…`);

    const firstReceipt = await this.waitForReceipt(firstTx.hash, timeoutMs);
    if (firstReceipt) {
      this.assertSucceeded(firstReceipt);
      return { txHash: firstTx.hash, receipt: firstReceipt };
    }

    const replacementFeesCandidate = await this.getFeeOverrides();
    const replacementFees = this.buildReplacementFees(baseFees, replacementFeesCandidate);
    const replacementTx = await this.sendContractTx(params, nonce, replacementFees);
    pendingHashes.push(replacementTx.hash);

    const replacementReceipt = await this.waitForReceipt(replacementTx.hash, timeoutMs);
    if (replacementReceipt) {
      this.assertSucceeded(replacementReceipt);
      return { txHash: replacementTx.hash, receipt: replacementReceipt };
    }

    throw new Error(
      `[${LABEL}] tx timed out; pending hashes=${JSON.stringify(uniqueHashes(pendingHashes))}`,
    );
  }

  private async sendContractTx(
    params: ExecuteParams,
    nonce: number,
    feeOverrides: FeeOverrides,
  ): Promise<ethers.ContractTransaction> {
    const contract = new ethers.Contract(params.contractAddress, params.contractAbi, this.signer);
    const method = (contract as Record<string, unknown>)[params.method];
    if (typeof method !== 'function') {
      throw new Error(`Unknown contract method: ${params.method}`);
    }

    const overrides: ethers.PayableOverrides = {
      nonce,
      ...feeOverrides,
    };
    if (params.gasLimit) overrides.gasLimit = params.gasLimit;
    if (params.value) overrides.value = params.value;

    return method(...params.args, overrides) as Promise<ethers.ContractTransaction>;
  }

  private async waitForReceipt(
    txHash: string,
    timeoutMs: number,
  ): Promise<ethers.ContractReceipt | null> {
    try {
      const receipt = await this.provider.waitForTransaction(txHash, 1, timeoutMs);
      return receipt ?? null;
    } catch {
      return null;
    }
  }

  private assertSucceeded(receipt: ethers.ContractReceipt): void {
    if (receipt.status === 0) {
      throw new Error(`[${LABEL}] transaction reverted: ${receipt.transactionHash}`);
    }
  }

  private async pollPendingHashes(
    hashes: string[],
    timeoutMs: number,
  ): Promise<ethers.ContractReceipt | null> {
    const unique = uniqueHashes(hashes);
    if (unique.length === 0) return null;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      for (const hash of unique) {
        const receipt = await this.provider.getTransactionReceipt(hash);
        if (!receipt) continue;
        this.assertSucceeded(receipt);
        return receipt;
      }
      await new Promise((r) => setTimeout(r, RECEIPT_POLL_INTERVAL_MS));
    }
    return null;
  }

  private async getFeeOverrides(): Promise<FeeOverrides> {
    const floorTip = ethers.utils.parseUnits(String(POLYGON_GAS_TIP_GWEI), 'gwei');
    const floorMax = ethers.utils.parseUnits(String(POLYGON_GAS_MAX_FEE_GWEI), 'gwei');
    try {
      const res = await fetch(GAS_STATION_URL);
      if (res.ok) {
        const data = (await res.json()) as { fast?: { maxPriorityFee: number; maxFee: number } };
        const fast = data.fast;
        if (fast && typeof fast.maxPriorityFee === 'number' && typeof fast.maxFee === 'number') {
          const tip = ethers.utils.parseUnits(String(Math.ceil(fast.maxPriorityFee * 1.2)), 'gwei');
          const max = ethers.utils.parseUnits(String(Math.ceil(fast.maxFee * 1.2)), 'gwei');
          return {
            maxPriorityFeePerGas: tip.gt(floorTip) ? tip : floorTip,
            maxFeePerGas: max.gt(floorMax) ? max : floorMax,
          };
        }
      }
    } catch {
      // fall through to static
    }
    return {
      maxPriorityFeePerGas: floorTip,
      maxFeePerGas: floorMax,
    };
  }

  private buildReplacementFees(
    original: FeeOverrides,
    latest: FeeOverrides,
  ): FeeOverrides {
    const bump = (v: ethers.BigNumber) => multiplyFee(v, REPLACEMENT_BUMP_PERCENT).add(1);
    const bumped: FeeOverrides = {
      gasPrice: original.gasPrice ? bump(original.gasPrice) : undefined,
      maxFeePerGas: original.maxFeePerGas ? bump(original.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: original.maxPriorityFeePerGas
        ? bump(original.maxPriorityFeePerGas)
        : undefined,
    };
    return {
      gasPrice: maxDefinedFee(latest.gasPrice, bumped.gasPrice),
      maxFeePerGas: maxDefinedFee(latest.maxFeePerGas, bumped.maxFeePerGas),
      maxPriorityFeePerGas: maxDefinedFee(
        latest.maxPriorityFeePerGas,
        bumped.maxPriorityFeePerGas,
      ),
    };
  }

  /** Replace stuck nonces with 0-value self-transfers (2x gas). Call on timeout or recoverable errors. */
  async resetStuckNonces(): Promise<void> {
    const latest = await this.provider.getTransactionCount(this.signer.address, 'latest');
    const pending = await this.provider.getTransactionCount(this.signer.address, 'pending');
    if (pending <= latest) return;

    const fees = await this.getFeeOverrides();
    const tip2x = (fees.maxPriorityFeePerGas ?? ethers.utils.parseUnits('120', 'gwei')).mul(2);
    const max2x = (fees.maxFeePerGas ?? ethers.utils.parseUnits('400', 'gwei')).mul(2);

    for (let n = latest; n < pending; n++) {
      try {
        const tx = await this.signer.sendTransaction({
          to: this.signer.address,
          value: ethers.BigNumber.from(0),
          nonce: n,
          gasLimit: NONCE_RECOVERY_GAS_LIMIT,
          maxPriorityFeePerGas: tip2x,
          maxFeePerGas: max2x,
        });
        console.log(`[${LABEL}] Nonce reset tx ${n}: ${tx.hash}`);
        await tx.wait();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('nonce too low') || msg.includes('NONCE_EXPIRED')) {
          break; // already cleared
        }
        throw e;
      }
    }
  }
}
