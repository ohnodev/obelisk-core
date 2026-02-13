/**
 * BuyNotifyNode – when Clanker Buy succeeds, builds a single Telegram send_message action
 * with a buy notification (amount, token, and Basescan tx link). Connect to TelegramAction
 * with chat_id so the message is sent to the defined chat.
 *
 * Inputs: buy_result (from Clanker Buy: success, txHash, token_address, amount_wei, symbol?), chat_id
 * Outputs: actions (for TelegramAction), chat_id
 */
import { BaseNode, ExecutionContext } from "../nodeBase";

const ETH_WEI = 1e18;
const BASESCAN_TX = "https://basescan.org/tx";

/** Format wei as human-readable ETH (e.g. "0.002", "0.00001") with no trailing zeros. */
function formatEth(wei: string | number): string {
  const n = typeof wei === "string" ? Number(wei) : wei;
  if (!Number.isFinite(n)) return "0";
  const eth = n / ETH_WEI;
  if (eth === 0) return "0";
  const s = eth.toFixed(8);
  return String(parseFloat(s));
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export class BuyNotifyNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const buyResult = this.getInputValue("buy_result", context, undefined) as Record<string, unknown> | undefined;
    const chatId = (this.getInputValue("chat_id", context, undefined) as string) ?? "";

    const success = buyResult?.success === true;
    const txHash = buyResult?.txHash as string | undefined;
    const tokenAddress = (buyResult?.token_address as string) ?? "";
    const amountWei = (buyResult?.amount_wei as string) ?? "0";
    const symbol = (buyResult?.symbol as string) || (buyResult?.name as string);

    const actions: Array<{ action: string; params: Record<string, unknown> }> = [];
    if (success && txHash) {
      const ethAmount = formatEth(amountWei);
      const tokenLabel = symbol || (tokenAddress ? shortAddress(tokenAddress) : "token");
      const txUrl = `${BASESCAN_TX}/${txHash}`;
      const text = `Bought ${ethAmount} ETH of ${tokenLabel}. Tx: ${txUrl}`;
      actions.push({ action: "send_message", params: { text } });
    }

    return {
      actions,
      chat_id: chatId,
    };
  }
}
