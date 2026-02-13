/**
 * CabalSwapper V4 execution – new contract with WETH pool support.
 * Used by Buy/Sell nodes to execute swaps on Base.
 * For WETH pools: wrap ETH → WETH, approve contract, then cabalBuyV4WithPool.
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
    outputs: [{ internalType: "uint256", name: "tokensReceived", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "currency0", type: "address" },
      { internalType: "address", name: "currency1", type: "address" },
      { internalType: "uint24", name: "poolFee", type: "uint24" },
      { internalType: "int24", name: "tickSpacing", type: "int24" },
      { internalType: "address", name: "hookAddress", type: "address" },
      { internalType: "uint256", name: "wethAmount", type: "uint256" },
    ],
    name: "cabalBuyV4WithPool",
    outputs: [{ internalType: "uint256", name: "tokensReceived", type: "uint256" }],
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
    outputs: [{ internalType: "uint256", name: "ethReceived", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "currency0", type: "address" },
      { internalType: "address", name: "currency1", type: "address" },
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "uint24", name: "poolFee", type: "uint24" },
      { internalType: "int24", name: "tickSpacing", type: "int24" },
      { internalType: "address", name: "hookAddress", type: "address" },
    ],
    name: "cabalSellV4WithPool",
    outputs: [{ internalType: "uint256", name: "amountReceived", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const WETH_ABI = [
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const CABAL_SWAPPER_ADDRESS =
  "0x5e89Fb6079a7Aa593c9152fa28BCfe034D5cBb00" as const;
export const WETH_BASE =
  "0x4200000000000000000000000000000000000006" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BASE_CHAIN_ID = 8453;

export interface SwapExecuteParams {
  tokenAddress: string;
  amountWei: string;
  isBuy: boolean;
  poolFee?: number;
  tickSpacing?: number;
  hookAddress?: string;
  /** Pool currency0 – with currency1 used for cabalBuyV4WithPool (WETH pools) */
  currency0?: string;
  /** Pool currency1 */
  currency1?: string;
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

function isWethPool(currency0?: string, currency1?: string): boolean {
  const w = WETH_BASE.toLowerCase();
  return (
    (currency0?.toLowerCase() === w || currency1?.toLowerCase() === w) &&
    !!currency0 &&
    !!currency1
  );
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
  const currency0 = params.currency0 && ethers.isAddress(params.currency0) ? params.currency0 : undefined;
  const currency1 = params.currency1 && ethers.isAddress(params.currency1) ? params.currency1 : undefined;

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
      if (isWethPool(currency0, currency1)) {
        const weth = new ethers.Contract(
          WETH_BASE,
          WETH_ABI as any,
          wallet
        );
        const txWrap = await weth.deposit({ value: amount });
        await txWrap.wait();
        const txApprove = await weth.approve(CABAL_SWAPPER_ADDRESS, amount);
        await txApprove.wait();
        const txBuy = await contract.cabalBuyV4WithPool(
          currency0!,
          currency1!,
          fee,
          tick,
          hook,
          amount,
          { value: 0n }
        );
        const receipt = await txBuy.wait();
        return { success: true, txHash: receipt?.hash ?? undefined };
      }
      const tx = await contract.cabalBuyV4WithPool(
        ZERO_ADDRESS,
        token,
        fee,
        tick,
        hook,
        0n,
        { value: amount }
      );
      const receipt = await tx.wait();
      return { success: true, txHash: receipt?.hash ?? undefined };
    }

    if (isWethPool(currency0, currency1)) {
      const tokenContract = new ethers.Contract(
        token,
        ["function approve(address spender, uint256 amount) returns (bool)"],
        wallet
      );
      const txApprove = await tokenContract.approve(CABAL_SWAPPER_ADDRESS, amount);
      await txApprove.wait();
      const txSell = await contract.cabalSellV4WithPool(
        currency0!,
        currency1!,
        amount,
        fee,
        tick,
        hook
      );
      const receipt = await txSell.wait();
      return { success: true, txHash: receipt?.hash ?? undefined };
    }
    const tokenContract = new ethers.Contract(
      token,
      ["function approve(address spender, uint256 amount) returns (bool)"],
      wallet
    );
    const txApprove = await tokenContract.approve(CABAL_SWAPPER_ADDRESS, amount);
    await txApprove.wait();
    const tx = await contract.cabalSellV4(token, amount, fee, tick, hook);
    const receipt = await tx.wait();
    return { success: true, txHash: receipt?.hash ?? undefined };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
