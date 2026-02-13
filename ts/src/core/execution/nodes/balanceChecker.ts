/**
 * BalanceCheckerNode – checks ETH + WETH combined balance for the wallet (from private_key).
 * Ensures at least GAS_RESERVE_ETH (0.001) is available in native ETH for gas.
 * If native ETH is below gas reserve but WETH is sufficient, automatically unwraps WETH → ETH
 * so the wallet has enough native ETH for gas.
 *
 * Inputs:
 *   private_key: From Wallet node or env (required for address + RPC)
 *   min_balance_wei: Minimum required combined (ETH+WETH) balance in wei (optional; default 0.004 ETH)
 *
 * Outputs:
 *   has_sufficient_funds: true if (eth + weth >= min) and (eth >= gas reserve)
 *   balance_wei: Combined balance in wei (string)
 *   balance_eth: Combined balance in ETH (number)
 *   eth_balance_wei / eth_balance_eth: Native ETH (for gas)
 *   weth_balance_wei / weth_balance_eth: WETH balance
 *   unwrapped_wei: If we unwrapped WETH this run, amount unwrapped (string); otherwise "0"
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
    const gasReserveWei = parseWei(GAS_RESERVE_ETH);
    const unwrapBufferWei = parseWei(UNWRAP_BUFFER_ETH);

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
      const wallet = new ethers.Wallet(privateKey, provider);
      let ethWei = await provider.getBalance(wallet.address);
      const wethContractRead = new ethers.Contract(WETH_ADDRESS, WETH_ABI, provider);
      let wethWei = await wethContractRead.balanceOf(wallet.address).catch(() => 0n);

      // If we don't have enough native ETH for gas but have enough WETH, unwrap some WETH → ETH
      let unwrappedWei = 0n;
      if (ethWei < gasReserveWei && wethWei > 0n) {
        const needWei = gasReserveWei - ethWei;
        const toUnwrapRaw = needWei + unwrapBufferWei;
        const toUnwrap = toUnwrapRaw <= wethWei ? toUnwrapRaw : wethWei;
        if (toUnwrap > 0n) {
          try {
            const wethWithWallet = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
            const tx = await wethWithWallet.withdraw(toUnwrap);
            logger.info(`[BalanceChecker] Unwrapping ${ethers.formatEther(toUnwrap)} WETH for gas (tx: ${tx.hash})`);
            await tx.wait();
            unwrappedWei = toUnwrap;
            ethWei = await provider.getBalance(wallet.address);
            wethWei = await wethContractRead.balanceOf(wallet.address).catch(() => 0n);
          } catch (e) {
            logger.warn(`[BalanceChecker] WETH unwrap failed: ${e instanceof Error ? e.message : e}`);
          }
        }
      }

      const combinedWei = ethWei + wethWei;
      const ethEth = Number(ethers.formatEther(ethWei));
      const wethEth = Number(ethers.formatEther(wethWei));
      const combinedEth = ethEth + wethEth;

      const hasEnoughCombined = combinedWei >= minBalanceWei;
      const hasEnoughGas = ethWei >= gasReserveWei;
      const hasSufficientFunds = hasEnoughCombined && hasEnoughGas;

      logger.debug(
        `[BalanceChecker] ${wallet.address} eth=${ethEth.toFixed(6)} weth=${wethEth.toFixed(6)} combined=${combinedEth.toFixed(6)} ETH, min=${ethers.formatEther(minBalanceWei)} ETH, gas_reserve=${ethers.formatEther(gasReserveWei)} ETH → sufficient=${hasSufficientFunds}`
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
