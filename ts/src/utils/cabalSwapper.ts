/**
 * CabalSwapper V4 execution – new contract with WETH pool support.
 * Used by Buy/Sell nodes to execute swaps on Base.
 * For WETH pools: wrap ETH → WETH, approve contract, then cabalBuyV4WithPool.
 * Parses the Swap log from the tx receipt to return actual tokens received.
 */
import { ethers } from "ethers";

// Uniswap V4 Pool Manager on Base (same as blockchain-service)
const POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b".toLowerCase();
const UNIV4_SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const WETH_ABI = ["function withdraw(uint256 wad)"];
const GAS_RESERVE_ETH = "0.001";
const UNWRAP_BUFFER_ETH = "0.0005";

function isInsufficientFundsError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("insufficient") ||
    m.includes("balance") ||
    m.includes("not enough") ||
    m.includes("gas") ||
    m.includes("funds")
  );
}

async function unwrapWethForGas(wallet: ethers.Wallet): Promise<void> {
  const provider = wallet.provider;
  if (!provider) return;
  const ethWei = await provider.getBalance(wallet.address);
  const gasReserveWei = ethers.parseEther(GAS_RESERVE_ETH);
  const unwrapBufferWei = ethers.parseEther(UNWRAP_BUFFER_ETH);
  if (ethWei >= gasReserveWei) return;
  const wethContract = new ethers.Contract(WETH_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
  const wethWei = await wethContract.balanceOf(wallet.address).catch(() => 0n);
  if (wethWei === 0n) return;
  const needWei = gasReserveWei - ethWei;
  const toUnwrap = needWei + unwrapBufferWei <= wethWei ? needWei + unwrapBufferWei : wethWei;
  if (toUnwrap === 0n) return;
  const wethWithWallet = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
  const tx = await wethWithWallet.withdraw(toUnwrap);
  await tx.wait();
}

/** Decode V4 Swap log data: amount0, amount1, sqrtPriceX96, liquidity, tick, fee */
const SWAP_DATA_TYPES = ["int256", "int256", "uint160", "uint128", "int24", "uint24"] as const;

export type TransactionReceiptLike = {
  logs: Array<{ address: string; topics: string[]; data: string }>;
};

/**
 * Parse the first Uniswap V4 Swap log in the receipt and return the token amount received (wei string).
 * For a buy: we receive the token (positive delta) and spend WETH (negative). Token is either currency0 or currency1.
 */
export function parseSwapReceiptTokensReceived(
  receipt: TransactionReceiptLike,
  tokenAddress: string,
  currency0: string,
  currency1: string
): string {
  const token = tokenAddress.toLowerCase();
  const c0 = currency0?.toLowerCase() ?? "";
  const c1 = currency1?.toLowerCase() ?? "";
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  for (const log of receipt.logs) {
    if (log.address?.toLowerCase() !== POOL_MANAGER || log.topics?.[0] !== UNIV4_SWAP_TOPIC) continue;
    if (!log.data || log.data === "0x") continue;

    try {
      const decoded = abiCoder.decode(SWAP_DATA_TYPES as unknown as string[], log.data);
      const amount0 = BigInt(decoded[0].toString());
      const amount1 = BigInt(decoded[1].toString());

      // Token side: which delta is for our token
      const tokenDelta = token === c0 ? amount0 : token === c1 ? amount1 : 0n;
      if (tokenDelta > 0n) return String(tokenDelta);
    } catch {
      continue;
    }
  }
  return "0";
}

/**
 * Parse the first Uniswap V4 Swap log and return the ETH/WETH amount received (wei string).
 * For a sell: we send token (negative delta) and receive WETH (positive delta).
 */
export function parseSwapReceiptEthReceived(
  receipt: TransactionReceiptLike,
  tokenIn: string,
  currency0: string,
  currency1: string
): string {
  const token = tokenIn.toLowerCase();
  const c0 = currency0?.toLowerCase() ?? "";
  const c1 = currency1?.toLowerCase() ?? "";
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  for (const log of receipt.logs) {
    if (log.address?.toLowerCase() !== POOL_MANAGER || log.topics?.[0] !== UNIV4_SWAP_TOPIC) continue;
    if (!log.data || log.data === "0x") continue;

    try {
      const decoded = abiCoder.decode(SWAP_DATA_TYPES as unknown as string[], log.data);
      const amount0 = BigInt(decoded[0].toString());
      const amount1 = BigInt(decoded[1].toString());

      // We're selling tokenIn, so its delta is negative. The other currency (WETH) is positive = we receive.
      const tokenDelta = token === c0 ? amount0 : token === c1 ? amount1 : 0n;
      const otherDelta = token === c0 ? amount1 : token === c1 ? amount0 : 0n;
      if (tokenDelta < 0n && otherDelta > 0n) return String(otherDelta);
    } catch {
      continue;
    }
  }
  return "0";
}

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
  "0xEa944F12Db53405fb9afd6D5b7878dcAfC97D46a" as const;
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
  /** Parsed from Swap log: actual token amount received (wei string). Set only on successful buy. */
  tokensReceived?: string;
  /** Parsed from Swap log: ETH/WETH received on sell (wei string). Set only on successful sell. */
  ethReceived?: string;
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
          { value: 0n, gasLimit: 3_000_000n }
        );
        const receipt = await txBuy.wait();
        let tokensReceived: string | undefined;
        if (receipt && currency0 && currency1) {
          tokensReceived = parseSwapReceiptTokensReceived(receipt as TransactionReceiptLike, token, currency0, currency1);
        }
        return { success: true, txHash: receipt?.hash ?? undefined, tokensReceived };
      }
      const tx = await contract.cabalBuyV4WithPool(
        ZERO_ADDRESS,
        token,
        fee,
        tick,
        hook,
        0n,
        { value: amount, gasLimit: 3_000_000n }
      );
      const receipt = await tx.wait();
      let tokensReceived: string | undefined;
      if (receipt) {
        tokensReceived = parseSwapReceiptTokensReceived(receipt as TransactionReceiptLike, token, ZERO_ADDRESS, token);
      }
      return { success: true, txHash: receipt?.hash ?? undefined, tokensReceived };
    }

    if (isWethPool(currency0, currency1)) {
      const tokenContract = new ethers.Contract(
        token,
        ["function approve(address spender, uint256 amount) returns (bool)"],
        wallet
      );
      const txApprove = await tokenContract.approve(CABAL_SWAPPER_ADDRESS, amount);
      await txApprove.wait();
      // Send sell tx with fixed gas so it's broadcast even if estimateGas would revert (so you can trace the revert)
      const populated = await contract.cabalSellV4WithPool.populateTransaction(
        currency0!,
        currency1!,
        amount,
        fee,
        tick,
        hook
      );
      const sendAndWait = async (): Promise<ethers.TransactionResponse> => {
        const txSell = await wallet.sendTransaction({
          to: CABAL_SWAPPER_ADDRESS,
          data: populated.data,
          gasLimit: 3_000_000n,
        });
        return txSell;
      };
      let txSell: ethers.TransactionResponse;
      let sellTxHash: string | undefined;
      try {
        txSell = await sendAndWait();
        sellTxHash = txSell?.hash ?? undefined;
      } catch (sendErr: unknown) {
        const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        if (isInsufficientFundsError(sendMsg)) {
          await unwrapWethForGas(wallet);
          txSell = await sendAndWait();
          sellTxHash = txSell?.hash ?? undefined;
        } else {
          return { success: false, error: sendMsg, txHash: undefined };
        }
      }
      try {
        const receipt = await txSell!.wait();
        if (receipt?.status === 0) {
          return { success: false, error: "Sell reverted on-chain", txHash: receipt?.hash ?? sellTxHash };
        }
        const ethReceived =
          receipt && currency0 && currency1
            ? parseSwapReceiptEthReceived(receipt as TransactionReceiptLike, token, currency0, currency1)
            : undefined;
        return { success: true, txHash: receipt?.hash ?? sellTxHash, ethReceived };
      } catch (waitErr: unknown) {
        const waitMsg = waitErr instanceof Error ? waitErr.message : String(waitErr);
        if (isInsufficientFundsError(waitMsg)) {
          await unwrapWethForGas(wallet);
          try {
            const txSell2 = await sendAndWait();
            const receipt2 = await txSell2.wait();
            if (receipt2?.status === 0) {
              return { success: false, error: "Sell reverted on-chain (retry)", txHash: receipt2?.hash };
            }
            const ethReceived =
              receipt2 && currency0 && currency1
                ? parseSwapReceiptEthReceived(receipt2 as TransactionReceiptLike, token, currency0, currency1)
                : undefined;
            return { success: true, txHash: receipt2?.hash, ethReceived };
          } catch (retryErr: unknown) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            return { success: false, error: retryMsg, txHash: undefined };
          }
        }
        return { success: false, error: waitMsg, txHash: sellTxHash };
      }
    }
    const tokenContract = new ethers.Contract(
      token,
      ["function approve(address spender, uint256 amount) returns (bool)"],
      wallet
    );
    const txApprove = await tokenContract.approve(CABAL_SWAPPER_ADDRESS, amount);
    await txApprove.wait();
    const doSell = async (): Promise<{ receipt: ethers.TransactionReceipt | null; txHash: string | undefined }> => {
      const tx = await contract.cabalSellV4(token, amount, fee, tick, hook, { gasLimit: 3_000_000n });
      const receipt = await tx.wait();
      return { receipt: receipt as ethers.TransactionReceipt | null, txHash: receipt?.hash ?? undefined };
    };
    let receipt: ethers.TransactionReceipt | null;
    let txHash: string | undefined;
    try {
      const res = await doSell();
      receipt = res.receipt;
      txHash = res.txHash;
    } catch (sellErr: unknown) {
      const sellMsg = sellErr instanceof Error ? sellErr.message : String(sellErr);
      if (isInsufficientFundsError(sellMsg)) {
        await unwrapWethForGas(wallet);
        try {
          const res = await doSell();
          receipt = res.receipt;
          txHash = res.txHash;
        } catch (retryErr: unknown) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          return { success: false, error: retryMsg, txHash: undefined };
        }
      } else {
        const err = sellErr as { transaction?: { hash?: string }; receipt?: { hash?: string }; hash?: string };
        txHash = err?.transaction?.hash ?? err?.receipt?.hash ?? (typeof err?.hash === "string" ? err.hash : undefined);
        return { success: false, error: sellMsg, txHash };
      }
    }
    const ethReceived =
      receipt && currency0 && currency1
        ? parseSwapReceiptEthReceived(receipt as TransactionReceiptLike, token, currency0, currency1)
        : undefined;
    return { success: true, txHash: receipt?.hash ?? txHash, ethReceived };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    let txHash: string | undefined;
    const err = e as { transaction?: { hash?: string }; receipt?: { hash?: string }; hash?: string };
    if (err?.transaction?.hash) txHash = err.transaction.hash;
    else if (err?.receipt?.hash) txHash = err.receipt.hash;
    else if (err?.hash && typeof err.hash === "string") txHash = err.hash;
    return { success: false, error: msg, txHash };
  }
}
