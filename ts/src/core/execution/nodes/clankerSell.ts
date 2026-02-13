/**
 * ClankerSellNode – execute a V4 sell (token → WETH) using CabalSwapper.
 * Hook up Wallet for private_key; get params from sell_params (e.g. from BagChecker) or direct inputs.
 * Proceeds are WETH (Clanker pays WETH, not native ETH).
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { executeSwap } from "../../../utils/cabalSwapper";

const logger = getLogger("clankerSell");

export class ClankerSellNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const privateKey = (this.getInputValue("private_key", context, undefined) as string) ?? "";
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

    if (!privateKey || privateKey.length < 20) {
      logger.warn("[ClankerSell] No private_key (connect Wallet node)");
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
      process.env.RPC_URL
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
