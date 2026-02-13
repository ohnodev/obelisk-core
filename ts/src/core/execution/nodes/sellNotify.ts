/**
 * SellNotifyNode – when Clanker Sell succeeds, builds a single Telegram "reply" action
 * with a sell notification message. Connect to TelegramAction with chat_id.
 *
 * Inputs: sell_result (from Clanker Sell: success, txHash, token_address, amount_wei), chat_id
 * Outputs: actions (for TelegramAction), chat_id
 */
import { BaseNode, ExecutionContext } from "../nodeBase";

const ETH_WEI = 1e18;

function weiToEth(wei: string | number): string {
  const n = typeof wei === "string" ? Number(wei) : wei;
  if (!Number.isFinite(n)) return "0";
  return (n / ETH_WEI).toFixed(4);
}

export class SellNotifyNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const sellResult = this.getInputValue("sell_result", context, undefined) as Record<string, unknown> | undefined;
    const chatId = (this.getInputValue("chat_id", context, undefined) as string) ?? "";

    const success = sellResult?.success === true;
    const txHash = sellResult?.txHash as string | undefined;
    const tokenAddress = (sellResult?.token_address as string) ?? "";
    const amountWei = (sellResult?.amount_wei as string) ?? "0";

    const actions: Array<{ action: string; params: Record<string, unknown> }> = [];
    if (success && txHash) {
      const ethAmount = weiToEth(amountWei);
      const text = `Sold token ${tokenAddress} (${ethAmount} tokens). Tx: ${txHash}`;
      actions.push({ action: "reply", params: { text } });
    }

    return {
      actions,
      chat_id: chatId,
    };
  }
}
