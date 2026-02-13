/**
 * BalanceCheckerNode – checks ETH balance for the wallet (from private_key).
 * Outputs has_sufficient_funds (balance >= min_balance_wei) for use with Boolean Logic
 * to gate the buy flow (e.g. skip analysis + inference when insufficient funds).
 *
 * Inputs:
 *   private_key: From Wallet node or env (required for address + RPC)
 *   min_balance_wei: Minimum required balance in wei (optional; default from metadata or 0.004 ETH)
 *
 * Outputs:
 *   has_sufficient_funds: true if balance >= min_balance_wei
 *   balance_wei: Current balance in wei (string)
 *   balance_eth: Current balance in ETH (number, for display)
 */
import { ethers } from "ethers";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("balanceChecker");

const DEFAULT_MIN_ETH = "0.004";
const DEFAULT_RPC = "https://mainnet.base.org";

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

export class BalanceCheckerNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const privateKey =
      (this.getInputValue("private_key", context, undefined) as string) ??
      this.resolveEnvVar(this.metadata.private_key) ??
      process.env.SWAP_PRIVATE_KEY ??
      "";

    const minInput = this.getInputValue("min_balance_wei", context, undefined);
    const minFromMeta = this.metadata.min_balance_wei ?? this.metadata.min_eth;
    const minBalanceWei =
      minInput !== undefined && minInput !== null
        ? parseWei(minInput)
        : parseWei(minFromMeta ?? DEFAULT_MIN_ETH);

    if (!privateKey || privateKey.length < 20) {
      logger.warn("[BalanceChecker] No private_key (connect Wallet node or set SWAP_PRIVATE_KEY)");
      return {
        has_sufficient_funds: false,
        balance_wei: "0",
        balance_eth: 0,
        error: "Wallet not configured",
      };
    }

    const rpcUrl = (process.env.RPC_URL as string) || DEFAULT_RPC;

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
      const wallet = new ethers.Wallet(privateKey, provider);
      const balanceWei = await provider.getBalance(wallet.address);
      const balanceEth = Number(ethers.formatEther(balanceWei));
      const hasSufficientFunds = balanceWei >= minBalanceWei;

      logger.debug(
        `[BalanceChecker] ${wallet.address} balance=${balanceEth.toFixed(6)} ETH, min=${ethers.formatEther(minBalanceWei)} ETH → sufficient=${hasSufficientFunds}`
      );

      return {
        has_sufficient_funds: hasSufficientFunds,
        balance_wei: balanceWei.toString(),
        balance_eth: balanceEth,
        address: wallet.address,
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
