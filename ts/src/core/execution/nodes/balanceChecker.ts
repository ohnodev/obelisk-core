/**
 * BalanceCheckerNode
 *
 * Mode A (default): ETH + WETH gas balance guard.
 * Mode B (when token_address is provided): ERC20 token balance guard (e.g. USDC).
 *
 * In token mode you can pass per_side_amount and (optionally) double_sided=true
 * to require 2x per-side collateral (useful for YES/NO LP seeding).
 */
import { ethers } from "ethers";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("balanceChecker");

const DEFAULT_MIN_ETH = "0.004";
const GAS_RESERVE_ETH = "0.001";
const UNWRAP_BUFFER_ETH = "0.0005"; // extra to unwrap so we have buffer after gas
const DEFAULT_RPC = "https://mainnet.base.org";
/** WETH on Base */
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const WETH_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function withdraw(uint256 wad)",
];

function parseWei(value: unknown): bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && !Number.isNaN(value)) return ethers.parseEther(String(value));
  const s = String(value).trim();
  if (!s) return 0n;
  if (s.toLowerCase().endsWith("eth")) {
    try {
      return ethers.parseEther(s.replace(/eth$/i, "").trim());
    } catch {
      return 0n;
    }
  }
  // Pure integer string = wei (do not treat as ETH)
  if (/^\d+$/.test(s)) {
    try {
      return BigInt(s);
    } catch {
      return 0n;
    }
  }
  // Decimal or other ETH-like format = parse as ETH
  if (/^\d*\.?\d+$/.test(s)) {
    try {
      return ethers.parseEther(s);
    } catch {
      return 0n;
    }
  }
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function parseTokenUnits(value: unknown, decimals: number): bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && !Number.isNaN(value)) {
    if (Number.isInteger(value)) return BigInt(value);
    try {
      return ethers.parseUnits(String(value), decimals);
    } catch {
      return 0n;
    }
  }
  const s = String(value).trim();
  if (!s) return 0n;
  if (/^\d+$/.test(s)) {
    try {
      return BigInt(s);
    } catch {
      return 0n;
    }
  }
  try {
    return ethers.parseUnits(s, decimals);
  } catch {
    return 0n;
  }
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return fallback;
}

export class BalanceCheckerNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return {
        has_sufficient_funds: false,
        skipped: true,
        reason: "trigger is false",
      };
    }

    const privateKey =
      (this.getInputValue("private_key", context, undefined) as string) ??
      this.resolveEnvVar(this.metadata.private_key) ??
      process.env.SWAP_PRIVATE_KEY ??
      "";
    const walletAddressInput =
      String(this.getInputValue("wallet_address", context, undefined) ?? "").trim() ||
      String(this.resolveEnvVar(this.metadata.wallet_address) ?? "").trim();
    const tokenAddress =
      String(this.getInputValue("token_address", context, undefined) ?? "").trim() ||
      String(this.resolveEnvVar(this.metadata.token_address) ?? "").trim();
    const tokenDecimalsRaw =
      this.getInputValue("token_decimals", context, undefined) ??
      this.resolveEnvVar(this.metadata.token_decimals) ??
      6;
    const tokenDecimals = Math.max(0, Math.floor(Number(tokenDecimalsRaw) || 6));
    const perSideAmountRaw =
      this.getInputValue("per_side_amount", context, undefined) ??
      this.resolveEnvVar(this.metadata.per_side_amount);
    const doubleSidedRaw =
      this.getInputValue("double_sided", context, undefined) ??
      this.resolveEnvVar(this.metadata.double_sided);

    const minInput = this.getInputValue("min_balance_wei", context, undefined);
    const minFromMeta = this.metadata.min_balance_wei ?? this.metadata.min_eth;
    const minBalanceWei =
      minInput !== undefined && minInput !== null
        ? parseWei(minInput)
        : parseWei(minFromMeta ?? DEFAULT_MIN_ETH);

    const rpcUrl = (process.env.RPC_URL as string) || DEFAULT_RPC;
    const gasReserveWei = parseWei(GAS_RESERVE_ETH);
    const targetNativeWei = minBalanceWei > gasReserveWei ? minBalanceWei : gasReserveWei;
    const unwrapBufferWei = parseWei(UNWRAP_BUFFER_ETH);

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
      const wallet =
        privateKey && privateKey.length >= 20
          ? new ethers.Wallet(privateKey, provider)
          : null;
      const resolvedAddress = walletAddressInput || wallet?.address || "";
      if (!resolvedAddress || !ethers.isAddress(resolvedAddress)) {
        logger.warn("[BalanceChecker] No valid wallet address");
        return {
          has_sufficient_funds: false,
          balance_wei: "0",
          balance_eth: 0,
          error: "Wallet not configured",
        };
      }

      // Token mode: generic ERC20 balance guard for an address.
      if (tokenAddress && ethers.isAddress(tokenAddress)) {
        const tokenRead = new ethers.Contract(
          tokenAddress,
          ["function balanceOf(address) view returns (uint256)"],
          provider
        );
        const tokenBalance = (await tokenRead.balanceOf(resolvedAddress).catch(() => 0n)) as bigint;
        const perSideAmount = parseTokenUnits(perSideAmountRaw, tokenDecimals);
        const isDoubleSided = parseBool(doubleSidedRaw, true);
        const requiredToken =
          perSideAmount > 0n
            ? perSideAmount * (isDoubleSided ? 2n : 1n)
            : parseTokenUnits(minInput ?? minFromMeta ?? "0", tokenDecimals);
        const hasEnough = tokenBalance >= requiredToken;
        return {
          has_sufficient_funds: hasEnough,
          address: resolvedAddress,
          token_address: tokenAddress,
          token_decimals: tokenDecimals,
          token_balance: tokenBalance.toString(),
          required_balance: requiredToken.toString(),
          double_sided: isDoubleSided,
        };
      }

      if (!wallet) {
        logger.warn("[BalanceChecker] No private_key for ETH/WETH mode");
        return {
          has_sufficient_funds: false,
          balance_wei: "0",
          balance_eth: 0,
          error: "Wallet private key required for ETH/WETH mode",
        };
      }

      let ethWei = await provider.getBalance(wallet.address);
      const wethContractRead = new ethers.Contract(WETH_ADDRESS, WETH_ABI, provider);
      let wethWei = await wethContractRead.balanceOf(wallet.address).catch(() => 0n);

      // If native ETH is below the required threshold, unwrap WETH into ETH.
      let unwrappedWei = 0n;
      if (ethWei < targetNativeWei && wethWei > 0n) {
        const needWei = targetNativeWei - ethWei;
        const toUnwrapRaw = needWei + unwrapBufferWei;
        const toUnwrap = toUnwrapRaw <= wethWei ? toUnwrapRaw : wethWei;
        try {
          const wethWithWallet = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
          const tx = await wethWithWallet.withdraw(toUnwrap);
          logger.info(
            `[BalanceChecker] Unwrapping ${ethers.formatEther(toUnwrap)} WETH to reach target native balance (${ethers.formatEther(targetNativeWei)} ETH; buffer=${ethers.formatEther(unwrapBufferWei)} ETH) (tx: ${tx.hash})`
          );
          await tx.wait();
          unwrappedWei = toUnwrap;
          ethWei = await provider.getBalance(wallet.address);
          wethWei = await wethContractRead.balanceOf(wallet.address).catch(() => 0n);
        } catch (e) {
          logger.warn(`[BalanceChecker] WETH unwrap failed: ${e instanceof Error ? e.message : e}`);
        }
      }

      const combinedWei = ethWei + wethWei;
      const ethEth = Number(ethers.formatEther(ethWei));
      const wethEth = Number(ethers.formatEther(wethWei));
      const combinedEth = ethEth + wethEth;

      const hasEnoughNative = ethWei >= targetNativeWei;
      // Invariant: ethWei >= targetNativeWei and targetNativeWei >= minBalanceWei imply (ethWei + wethWei) >= minBalanceWei.
      const hasSufficientFunds = hasEnoughNative;

      logger.debug(
        `[BalanceChecker] ${wallet.address} eth=${ethEth.toFixed(6)} weth=${wethEth.toFixed(6)} combined=${combinedEth.toFixed(6)} ETH, min=${ethers.formatEther(minBalanceWei)} ETH, gas_reserve=${ethers.formatEther(gasReserveWei)} ETH, native_target=${ethers.formatEther(targetNativeWei)} ETH → sufficient=${hasSufficientFunds}`
      );

      return {
        has_sufficient_funds: hasSufficientFunds,
        balance_wei: combinedWei.toString(),
        balance_eth: combinedEth,
        eth_balance_wei: ethWei.toString(),
        eth_balance_eth: ethEth,
        weth_balance_wei: wethWei.toString(),
        weth_balance_eth: wethEth,
        address: wallet.address,
        unwrapped_wei: unwrappedWei.toString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[BalanceChecker] RPC failed: ${message}`);
      return {
        has_sufficient_funds: false,
        balance_wei: "0",
        balance_eth: 0,
        error: message,
      };
    }
  }
}
