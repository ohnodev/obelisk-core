/**
 * SellNotifyNode – when Clanker Sell succeeds, sends a sell notification to Telegram.
 * Includes Basescan tx link and PnL (received ETH vs cost from holding).
 *
 * Inputs: sell_result, holding (from BagChecker), chat_id, bot_token (optional; from Text node or {{process.env.TELEGRAM_BOT_TOKEN}})
 * Outputs: sent (boolean), chat_id, error (if send failed)
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { Config } from "../../config";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("sellNotify");
const ETH_WEI = 1e18;
const BASESCAN_TX = "https://basescan.org/tx";
const TELEGRAM_API = "https://api.telegram.org/bot";

function weiToEth(wei: string | number): string {
  const n = typeof wei === "string" ? Number(wei) : wei;
  if (!Number.isFinite(n)) return "0";
  return (n / ETH_WEI).toFixed(4);
}

function formatEth(wei: string | number): string {
  const n = typeof wei === "string" ? Number(wei) : wei;
  if (!Number.isFinite(n)) return "0";
  const eth = n / ETH_WEI;
  if (eth === 0) return "0";
  const s = eth.toFixed(8);
  return String(parseFloat(s));
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
  logger.warn(`[SellNotify] Telegram send failed: ${err}`);
  return { ok: false, error: err };
}

export class SellNotifyNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const sellResult = this.getInputValue("sell_result", context, undefined) as Record<string, unknown> | undefined;
    const holding = this.getInputValue("holding", context, undefined) as Record<string, unknown> | undefined;
    const chatId =
      (this.getInputValue("chat_id", context, undefined) as string)?.trim() ||
      Config.TELEGRAM_CHAT_ID ||
      "";

    const rawBotToken =
      (this.getInputValue("bot_token", context, undefined) as string)?.trim() ||
      (this.metadata.bot_token as string)?.trim() ||
      "";
    let botToken =
      (rawBotToken ? (this.resolveEnvVar(rawBotToken) as string)?.trim() : "") ||
      Config.TELEGRAM_BOT_TOKEN ||
      "";
    // If still unresolved (e.g. Text node had {{process.env.TELEGRAM_BOT_TOKEN}} but env wasn't set), use env/Config at execute time
    if (!botToken || botToken.startsWith("{{")) {
      botToken = (
        process.env.TELEGRAM_BOT_TOKEN ||
        process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN ||
        Config.TELEGRAM_BOT_TOKEN ||
        ""
      ).trim();
    }

    const success = sellResult?.success === true;
    const txHash = sellResult?.txHash as string | undefined;
    const tokenAddress = (sellResult?.token_address as string) ?? "";
    const amountWei = (sellResult?.amount_wei as string) ?? "0";
    const receivedWei =
      (sellResult?.value_wei as string) ?? (sellResult?.eth_received as string) ?? "0";

    let sent = false;
    let error: string | undefined;
    if (success && txHash) {
      const txUrl = `${BASESCAN_TX}/${txHash}`;
      const tokenAmount = weiToEth(amountWei);
      const receivedEth = formatEth(receivedWei);
      let pnlPart = "";
      if (holding && typeof holding.boughtAtPriceEth === "number" && holding.amountWei) {
        const costEth = holding.boughtAtPriceEth * (Number(holding.amountWei) / ETH_WEI);
        const receivedEthNum = Number(receivedWei) / ETH_WEI;
        const pnlEth = receivedEthNum - costEth;
        const pnlPct = costEth > 0 ? (pnlEth / costEth) * 100 : 0;
        pnlPart = ` Received ${receivedEth} ETH. PnL: ${pnlEth >= 0 ? "+" : ""}${pnlEth.toFixed(6)} ETH (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%).`;
      } else {
        pnlPart = ` Received ${receivedEth} ETH.`;
      }
      const text = `Sold token ${tokenAddress} (${tokenAmount} tokens).${pnlPart} Tx: ${txUrl}`;
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
