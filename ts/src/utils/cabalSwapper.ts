/**
 * CabalSwapper V4 execution – same logic as blockchain-service/cabalSwapper.
 * Used by Buy/Sell nodes to execute swaps on Base.
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

const CABAL_SWAPPER_ADDRESS =
  "0xfCA9B201fAE87C4Db20EEB6a94947a2218EFC912" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BASE_CHAIN_ID = 8453;

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

function createWallet(privateKey: string, rpcUrl: string): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID, {
    staticNetwork: true,
  });
  return new ethers.Wallet(privateKey, provider);
}

export async function executeSwap(
  privateKey: string,
  params: SwapExecuteParams,
  rpcUrl?: string
): Promise<SwapExecuteResult> {
  const url = rpcUrl || process.env.RPC_URL || "https://mainnet.base.org";
  const wallet = createWallet(privateKey, url);

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
    const contract = new ethers.Contract(
      CABAL_SWAPPER_ADDRESS,
      CABAL_SWAPPER_ABI as any,
      wallet
    );
    if (params.isBuy) {
      const tx = await contract.cabalBuyV4(
        token,
        fee,
        tick,
        hook,
        { value: amount }
      );
      const receipt = await tx.wait();
      return { success: true, txHash: receipt?.hash ?? undefined };
    } else {
      const tx = await contract.cabalSellV4(token, amount, fee, tick, hook);
      const receipt = await tx.wait();
      return { success: true, txHash: receipt?.hash ?? undefined };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
