/**
 * BuyNotifyNode – when Clanker Buy succeeds, sends a buy notification directly to Telegram
 * (amount, token, Basescan tx link). Uses TELEGRAM_BOT_TOKEN and chat_id; no TelegramAction node.
 *
 * Inputs: buy_result (from Clanker Buy: success, txHash, token_address, amount_wei, symbol?), chat_id
 * Outputs: sent (boolean), chat_id, error (if send failed)
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { Config } from "../../config";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("buyNotify");
const ETH_WEI = 1e18;
const BASESCAN_TX = "https://basescan.org/tx";
const TELEGRAM_API = "https://api.telegram.org/bot";

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

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (!botToken || !chatId.trim()) {
    return { ok: false, error: "missing bot_token or chat_id" };
  }
  const url = `${TELEGRAM_API}${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId.trim(), text }),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (data?.ok) return { ok: true };
  const err = data?.description ?? `HTTP ${res.status}`;
  logger.warn(`[BuyNotify] Telegram send failed: ${err}`);
  return { ok: false, error: err };
}

export class BuyNotifyNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const buyResult = this.getInputValue("buy_result", context, undefined) as Record<string, unknown> | undefined;
    const chatId =
      (this.getInputValue("chat_id", context, undefined) as string)?.trim() ||
      Config.TELEGRAM_CHAT_ID ||
      "";

    const success = buyResult?.success === true;
    const txHash = buyResult?.txHash as string | undefined;
    const tokenAddress = (buyResult?.token_address as string) ?? "";
    const valueWei = (buyResult?.value_wei as string) ?? (buyResult?.amount_wei as string) ?? "0"; // ETH spent (value_wei from ClankerBuy)
    const symbol = (buyResult?.symbol as string) || (buyResult?.name as string);

    let sent = false;
    let error: string | undefined;
    if (success && txHash) {
      const ethAmount = formatEth(valueWei);
      const tokenLabel = symbol || (tokenAddress ? shortAddress(tokenAddress) : "token");
      const txUrl = `${BASESCAN_TX}/${txHash}`;
      const text = `Bought ${tokenLabel} for ${ethAmount} ETH. Tx: ${txUrl}`;
      const botToken = Config.TELEGRAM_BOT_TOKEN || "";
      const result = await sendTelegramMessage(botToken, chatId, text);
      sent = result.ok;
      error = result.error;
    }

    return {
      sent,
      chat_id: chatId,
      ...(error && { error }),
    };
  }
}
