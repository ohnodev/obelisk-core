/**
 * ClankerBuyNode – execute a V4 buy (ETH → token) using CabalSwapper.
 * Hook up Wallet node for private_key; get token and pool params from state or action router.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { executeSwap } from "../../../utils/cabalSwapper";

const logger = getLogger("clankerBuy");

function getActions(value: unknown): Array<{ action: string; params: Record<string, unknown> }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { action: string; params: Record<string, unknown> } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as any).action === "string" &&
      typeof (item as any).params === "object"
  );
}

export class ClankerBuyNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const privateKey = (this.getInputValue("private_key", context, undefined) as string) ?? "";
    const tgActions = getActions(this.getInputValue("tg_actions", context, undefined));

    let tokenAddress = (this.getInputValue("token_address", context, undefined) as string) ?? "";
    let amountWei = (this.getInputValue("amount_wei", context, undefined) as string) ??
      (this.getInputValue("amount", context, undefined) as string) ??
      "0";
    let poolFee = Number(this.getInputValue("pool_fee", context, undefined)) || 0;
    let tickSpacing = Number(this.getInputValue("tick_spacing", context, undefined)) ?? 0;
    let hookAddress = (this.getInputValue("hook_address", context, undefined) as string) ?? "";
    let currency0 = (this.getInputValue("currency0", context, undefined) as string) ?? "";
    let currency1 = (this.getInputValue("currency1", context, undefined) as string) ?? "";

    if (!tokenAddress && tgActions.length > 0) {
      const buyAction = tgActions.find((a) => String(a.action).toLowerCase() === "buy");
      if (buyAction?.params) {
        tokenAddress = String(buyAction.params.token_address ?? buyAction.params.tokenAddress ?? "").trim();
        amountWei = String(buyAction.params.amount_wei ?? buyAction.params.amountWei ?? buyAction.params.amount ?? "0").trim();
        poolFee = Number(buyAction.params.pool_fee ?? buyAction.params.poolFee ?? 0) || 0;
        tickSpacing = Number(buyAction.params.tick_spacing ?? buyAction.params.tickSpacing ?? 0) ?? 0;
        hookAddress = String(buyAction.params.hook_address ?? buyAction.params.hookAddress ?? "").trim();
        currency0 = String(buyAction.params.currency0 ?? "").trim();
        currency1 = String(buyAction.params.currency1 ?? "").trim();
      }
    }

    if (!privateKey || privateKey.length < 20) {
      logger.warn("[ClankerBuy] No private_key (connect Wallet node or set SWAP_PRIVATE_KEY)");
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
        isBuy: true,
        poolFee,
        tickSpacing,
        hookAddress: hookAddress || undefined,
        currency0: currency0 || undefined,
        currency1: currency1 || undefined,
      },
      process.env.RPC_URL
    );

    if (result.success) {
      logger.info(`[ClankerBuy] Swap tx: ${result.txHash}`);
    } else {
      logger.warn(`[ClankerBuy] Swap failed: ${result.error}`);
    }

    return {
      success: result.success,
      txHash: result.txHash,
      error: result.error,
    };
  }
}
