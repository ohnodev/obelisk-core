/**
 * ClankerSellNode – execute a V4 sell (token → WETH) using CabalSwapper.
 * Private key from metadata.private_key or SWAP_PRIVATE_KEY.
 * RPC URL from input rpc_url, metadata.rpc_url, or process.env.RPC_URL (default: mainnet Base).
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { executeSwap } from "../../../utils/cabalSwapper";

const logger = getLogger("clankerSell");
const DEFAULT_RPC_URL = "https://mainnet.base.org";

export class ClankerSellNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const privateKey =
      (this.getInputValue("private_key", context, undefined) as string) ??
      this.resolveEnvVar(this.metadata.private_key) ??
      process.env.SWAP_PRIVATE_KEY ??
      "";
    const shouldSell = this.getInputValue("should_sell", context, false) as boolean;
    const sellParams = this.getInputValue("sell_params", context, undefined) as Record<string, unknown> | undefined;

    if (!shouldSell) {
      return { success: true, skipped: true, txHash: undefined };
    }

    let tokenAddress = (this.getInputValue("token_address", context, undefined) as string) ?? "";
    let amountWei = (this.getInputValue("amount_wei", context, undefined) as string) ?? "0";
    let poolFee = Number(this.getInputValue("pool_fee", context, undefined)) || 0;
    let tickSpacing = Number(this.getInputValue("tick_spacing", context, undefined)) || 0;
    let hookAddress = (this.getInputValue("hook_address", context, undefined) as string) ?? "";
    let currency0 = (this.getInputValue("currency0", context, undefined) as string) ?? "";
    let currency1 = (this.getInputValue("currency1", context, undefined) as string) ?? "";

    if (sellParams) {
      tokenAddress = String(sellParams.token_address ?? tokenAddress).trim();
      amountWei = String(sellParams.amount_wei ?? amountWei).trim();
      poolFee = Number(sellParams.pool_fee ?? poolFee) || 0;
      tickSpacing = Number(sellParams.tick_spacing ?? tickSpacing) || 0;
      hookAddress = String(sellParams.hook_address ?? hookAddress).trim();
      currency0 = String(sellParams.currency0 ?? currency0).trim();
      currency1 = String(sellParams.currency1 ?? currency1).trim();
    }

    const fromInput = String(this.getInputValue("rpc_url", context, undefined) ?? "").trim();
    const fromMeta = this.resolveEnvVar(this.metadata.rpc_url);
    const rpcUrl =
      fromInput ||
      (typeof fromMeta === "string" && fromMeta.trim() ? fromMeta.trim() : "") ||
      process.env.RPC_URL ||
      DEFAULT_RPC_URL;

    if (!privateKey || privateKey.length < 20) {
      logger.warn("[ClankerSell] No private_key (set metadata.private_key or SWAP_PRIVATE_KEY)");
      return { success: false, error: "Wallet not configured", txHash: undefined };
    }

    if (!tokenAddress) {
      return { success: false, error: "token_address required", txHash: undefined };
    }

    const result = await executeSwap(
      privateKey,
      {
        tokenAddress,
        amountWei: String(amountWei),
        isBuy: false,
        poolFee,
        tickSpacing,
        hookAddress: hookAddress || undefined,
        currency0: currency0 || undefined,
        currency1: currency1 || undefined,
      },
      rpcUrl
    );

    if (result.success) {
      logger.info(`[ClankerSell] Sell tx: ${result.txHash}`);
    } else {
      logger.warn(`[ClankerSell] Sell failed: ${result.error}`);
    }

    const res = result as { wethReceived?: string; ethReceived?: string };
    const wethReceived = res.wethReceived ?? res.ethReceived;
    return {
      success: result.success,
      txHash: result.txHash,
      error: result.error,
      token_address: tokenAddress,
      amount_wei: String(amountWei),
      value_wei: wethReceived ?? undefined,
      weth_received: wethReceived ?? undefined,
      eth_received: wethReceived ?? undefined,
      result: {
        success: result.success,
        txHash: result.txHash,
        error: result.error,
        token_address: tokenAddress,
        amount_wei: amountWei,
        value_wei: wethReceived,
        weth_received: wethReceived,
        eth_received: wethReceived,
      },
    };
  }
}
