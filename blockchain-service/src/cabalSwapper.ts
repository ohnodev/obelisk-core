/**
 * CabalSwapper V4 execution – copied from cabal-eco/cabalfun for our blockchain-service.
 * Executes buy/sell on Base via the same CabalSwapper contract.
 */
import { ethers } from "ethers";

const CABAL_SWAPPER_ABI = [
  {
    inputs: [
      { internalType: "address", name: "tokenOut", type: "address" },
      { internalType: "uint24", name: "poolFee", type: "uint24" },
      { internalType: "int24", name: "tickSpacing", type: "int24" },
      { internalType: "address", name: "hookAddress", type: "address" },
    ],
    name: "cabalBuyV4",
    outputs: [
      { internalType: "uint256", name: "tokensReceived", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "tokenIn", type: "address" },
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "uint24", name: "poolFee", type: "uint24" },
      { internalType: "int24", name: "tickSpacing", type: "int24" },
      { internalType: "address", name: "hookAddress", type: "address" },
    ],
    name: "cabalSellV4",
    outputs: [
      { internalType: "uint256", name: "ethReceived", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const CABAL_SWAPPER_ADDRESS =
  "0x5e89Fb6079a7Aa593c9152fa28BCfe034D5cBb00" as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface SwapExecuteParams {
  tokenAddress: string;
  amountWei: string;
  isBuy: boolean;
  poolFee?: number;
  tickSpacing?: number;
  hookAddress?: string;
}

export interface SwapExecuteResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Execute V4 buy: send ETH, receive tokens.
 */
export async function executeBuyV4(
  wallet: ethers.Wallet,
  tokenOut: string,
  valueWei: bigint,
  poolFee: number,
  tickSpacing: number,
  hookAddress: string
): Promise<{ txHash: string }> {
  const contract = new ethers.Contract(
    CABAL_SWAPPER_ADDRESS,
    CABAL_SWAPPER_ABI as any,
    wallet
  );
  const tx = await contract.cabalBuyV4(
    tokenOut,
    poolFee,
    tickSpacing,
    hookAddress || ZERO_ADDRESS,
    { value: valueWei }
  );
  const receipt = await tx.wait();
  if (!receipt?.hash) throw new Error("No tx hash in receipt");
  return { txHash: receipt.hash };
}

/**
 * Execute V4 sell: send tokens, receive ETH.
 */
export async function executeSellV4(
  wallet: ethers.Wallet,
  tokenIn: string,
  amountInWei: bigint,
  poolFee: number,
  tickSpacing: number,
  hookAddress: string
): Promise<{ txHash: string }> {
  const contract = new ethers.Contract(
    CABAL_SWAPPER_ADDRESS,
    CABAL_SWAPPER_ABI as any,
    wallet
  );
  const tx = await contract.cabalSellV4(
    tokenIn,
    amountInWei,
    poolFee,
    tickSpacing,
    hookAddress || ZERO_ADDRESS
  );
  const receipt = await tx.wait();
  if (!receipt?.hash) throw new Error("No tx hash in receipt");
  return { txHash: receipt.hash };
}

/**
 * Run buy or sell based on params. Wallet must be created from SWAP_PRIVATE_KEY + provider.
 */
export async function executeSwap(
  wallet: ethers.Wallet,
  params: SwapExecuteParams
): Promise<SwapExecuteResult> {
  const token = params.tokenAddress;
  const amount = BigInt(params.amountWei);
  const fee = params.poolFee ?? 0;
  const tick = params.tickSpacing ?? 0;
  const hook =
    params.hookAddress && ethers.isAddress(params.hookAddress)
      ? params.hookAddress
      : ZERO_ADDRESS;

  if (!ethers.isAddress(token)) {
    return { success: false, error: "Invalid token address" };
  }
  if (amount <= 0n) {
    return { success: false, error: "Amount must be > 0" };
  }

  try {
    if (params.isBuy) {
      const { txHash } = await executeBuyV4(
        wallet,
        token,
        amount,
        fee,
        tick,
        hook
      );
      return { success: true, txHash };
    } else {
      const { txHash } = await executeSellV4(
        wallet,
        token,
        amount,
        fee,
        tick,
        hook
      );
      return { success: true, txHash };
    }
  } catch (e: any) {
    return {
      success: false,
      error: e?.message ?? String(e),
    };
  }
}
