/**
 * BuyNotifyNode – when Clanker Buy succeeds, builds a single Telegram "reply" action
 * with a buy notification message. Connect to TelegramAction with chat_id so the agent
 * can send "Bought token X for Y ETH. Tx: 0x..." to a defined chat.
 *
 * Inputs: buy_result (from Clanker Buy: success, txHash, token_address, amount_wei), chat_id
 * Outputs: actions (for TelegramAction), chat_id
 */
import { BaseNode, ExecutionContext } from "../nodeBase";

const ETH_WEI = 1e18;

function weiToEth(wei: string | number): string {
  const n = typeof wei === "string" ? Number(wei) : wei;
  if (!Number.isFinite(n)) return "0";
  return (n / ETH_WEI).toFixed(4);
}

export class BuyNotifyNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const buyResult = this.getInputValue("buy_result", context, undefined) as Record<string, unknown> | undefined;
    const chatId = (this.getInputValue("chat_id", context, undefined) as string) ?? "";

    const success = buyResult?.success === true;
    const txHash = buyResult?.txHash as string | undefined;
    const tokenAddress = (buyResult?.token_address as string) ?? "";
    const amountWei = (buyResult?.amount_wei as string) ?? "0";

    const actions: Array<{ action: string; params: Record<string, unknown> }> = [];
    if (success && txHash) {
      const ethAmount = weiToEth(amountWei);
      const text = `Bought token ${tokenAddress} for ${ethAmount} ETH. Tx: ${txHash}`;
      actions.push({ action: "reply", params: { text } });
    }

    return {
      actions,
      chat_id: chatId,
    };
  }
}
