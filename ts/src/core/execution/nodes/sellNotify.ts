/**
 * SellNotifyNode – when Clanker Sell succeeds, sends a sell notification to Telegram.
 * Formatted with token label (name/symbol from state), amount, received ETH, PnL when holding present, and Basescan tx link.
 *
 * Inputs: sell_result, holding (from BagChecker; for PnL), state (optional; for token name/symbol),
 *         chat_id, bot_token (optional; from Text node or {{process.env.TELEGRAM_BOT_TOKEN}})
 * Outputs: sent (boolean), chat_id, error (if send failed)
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { Config } from "../../config";
import { getLogger } from "../../../utils/logger";
import { getTelegramBotToken } from "../../../utils/telegram";

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
  logger.warn(`[SellNotify] Telegram send failed: ${err}`);
  return { ok: false, error: err };
}

export class SellNotifyNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const sellResult = this.getInputValue("sell_result", context, undefined) as Record<string, unknown> | undefined;
    const holding = this.getInputValue("holding", context, undefined) as Record<string, unknown> | undefined;
    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const chatId =
      (this.getInputValue("chat_id", context, undefined) as string)?.trim() ||
      Config.TELEGRAM_CHAT_ID ||
      "";

    const rawBotToken =
      (this.getInputValue("bot_token", context, undefined) as string)?.trim() ||
      (this.metadata.bot_token as string)?.trim() ||
      "";
    const resolvedInput = rawBotToken
      ? (this.resolveEnvVar(rawBotToken) as string)?.trim()
      : "";
    const botToken = getTelegramBotToken(resolvedInput);

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
      let name = "";
      let symbol = "";
      if (state?.tokens && typeof state.tokens === "object") {
        const t = (state.tokens as Record<string, Record<string, unknown>>)[tokenAddress.toLowerCase()];
        if (t) {
          name = String(t.name ?? "").trim();
          symbol = String(t.symbol ?? "").trim();
        }
      }
      const tokenLabel =
        name && symbol ? `${name} (${symbol})` : symbol || name || shortAddress(tokenAddress);
      const lines = [
        `🔴 Sold ${tokenLabel}`,
        `${tokenAmount} tokens → ${receivedEth} ETH`,
        tokenAddress ? `Address: ${shortAddress(tokenAddress)}` : null,
      ];
      if (holding && typeof holding.boughtAtPriceEth === "number" && holding.amountWei) {
        const costEth = holding.boughtAtPriceEth * (Number(holding.amountWei) / ETH_WEI);
        const receivedEthNum = Number(receivedWei) / ETH_WEI;
        const pnlEth = receivedEthNum - costEth;
        const pnlPct = costEth > 0 ? (pnlEth / costEth) * 100 : 0;
        const sign = pnlEth >= 0 ? "+" : "";
        lines.push(`PnL: ${sign}${pnlEth.toFixed(6)} ETH (${sign}${pnlPct.toFixed(2)}%)`);
      }
      lines.push(`Tx: ${txUrl}`);
      const text = lines.filter(Boolean).join("\n");
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
