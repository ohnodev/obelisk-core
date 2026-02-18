/**
 * SellNotifyNode – when Clanker Sell succeeds, sends a sell notification to Telegram
 * with a shareable profit card image.
 *
 * Inputs: sell_result, holding (from BagChecker; for PnL), state (optional; for token name/symbol),
 *         chat_id, bot_token (optional; from Text node or {{process.env.TELEGRAM_BOT_TOKEN}})
 * Outputs: sent (boolean), chat_id, error (if send failed)
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { Config } from "../../config";
import { getLogger } from "../../../utils/logger";
import { getTelegramBotToken } from "../../../utils/telegram";
import { fetchEthUsdPrice } from "../../../utils/ethPrice";
import { generateProfitCard, type ProfitCardData } from "../../../utils/profitCard";
import {
  sendTelegramMessage,
  sendTelegramPhoto,
  formatTokenLabel,
  safeErrorMessage,
} from "../../../utils/telegramNotify";

const logger = getLogger("sellNotify");
const ETH_WEI = 1e18;
const BASESCAN_TX = "https://basescan.org/tx";

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

export class SellNotifyNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const sellResult = this.getInputValue("sell_result", context, undefined) as Record<string, unknown> | undefined;
    const holding = this.getInputValue("holding", context, undefined) as Record<string, unknown> | undefined;
    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const rawChatId =
      (this.getInputValue("chat_id", context, undefined) as string)?.trim() ||
      (this.metadata.chat_id as string)?.trim() ||
      "";
    const chatId = rawChatId
      ? String(this.resolveEnvVar(rawChatId) ?? rawChatId).trim()
      : Config.TELEGRAM_CHAT_ID || "";

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
    const receivedEthNum = Number.isFinite(Number(receivedWei)) ? Number(receivedWei) / ETH_WEI : 0;

    let sent = false;
    let error: string | undefined;
    if (success && txHash) {
      const txUrl = `${BASESCAN_TX}/${txHash}`;
      const tokenAmount = weiToEth(amountWei);
      const receivedEthStr = formatEth(receivedWei);
      let name = "";
      let symbol = "";
      if (state?.tokens && typeof state.tokens === "object") {
        const t = (state.tokens as Record<string, Record<string, unknown>>)[tokenAddress.toLowerCase()];
        if (t) {
          name = String(t.name ?? "").trim();
          symbol = String(t.symbol ?? "").trim();
        }
      }
      if (!name) name = (sellResult?.name as string)?.trim() ?? (holding?.name as string)?.trim() ?? "";
      if (!symbol) symbol = (sellResult?.symbol as string)?.trim() ?? (holding?.symbol as string)?.trim() ?? "";
      const tokenLabel = formatTokenLabel(name, symbol, tokenAddress);

      let costEthNum = 0;
      let pnlPct = 0;
      let holdTime: string | undefined;
      if (holding && typeof holding.boughtAtPriceEth === "number" && holding.amountWei) {
        costEthNum = holding.boughtAtPriceEth * (Number(holding.amountWei) / ETH_WEI);
        const pnlEth = receivedEthNum - costEthNum;
        pnlPct = costEthNum > 0 ? (pnlEth / costEthNum) * 100 : 0;
        if (typeof holding.boughtAtTimestamp === "number" && holding.boughtAtTimestamp > 0) {
          const holdMs = Date.now() - (holding.boughtAtTimestamp as number);
          const holdMin = Math.floor(holdMs / 60_000);
          if (holdMin < 60) holdTime = `${holdMin}m`;
          else if (holdMin < 1440) holdTime = `${Math.floor(holdMin / 60)}h`;
          else holdTime = `${Math.floor(holdMin / 1440)}d`;
        }
      }

      const sign = pnlPct >= 0 ? "+" : "";
      const caption = [
        `🔴 Sold ${tokenLabel}`,
        `${tokenAmount} tokens → ${receivedEthStr} ETH`,
        ...(tokenAddress ? [`CA: ${tokenAddress}`] : []),
        ...(costEthNum > 0 ? [`PnL: ${sign}${(receivedEthNum - costEthNum).toFixed(6)} ETH (${sign}${pnlPct.toFixed(2)}%)`] : []),
        `Tx: ${txUrl}`,
      ].filter(Boolean).join("\n");

      let ethUsdPrice = 0;
      try { ethUsdPrice = await fetchEthUsdPrice(); } catch { /* non-critical */ }

      try {
        const cardData: ProfitCardData = {
          tokenName: symbol || name || "TOKEN",
          chain: "BASE",
          action: "SELL",
          profitPercent: pnlPct,
          initialEth: costEthNum || receivedEthNum,
          positionEth: receivedEthNum,
          ...(ethUsdPrice > 0 ? { ethUsdPrice } : {}),
          ...(holdTime ? { holdTime } : {}),
        };
        const imageBuffer = await generateProfitCard(cardData);
        const photoResult = await sendTelegramPhoto(botToken, chatId, imageBuffer, caption);
        if (photoResult.ok) {
          sent = true;
        } else {
          logger.warn(`[SellNotify] Photo send failed (${photoResult.error}), falling back to text`);
          const textResult = await sendTelegramMessage(botToken, chatId, caption);
          sent = textResult.ok;
          error = textResult.error;
        }
      } catch (cardErr) {
        logger.warn(`[SellNotify] Profit card generation failed, falling back to text: ${safeErrorMessage(cardErr)}`);
        const textResult = await sendTelegramMessage(botToken, chatId, caption);
        sent = textResult.ok;
        error = textResult.error;
      }
    }

    return {
      sent,
      chat_id: chatId,
      ...(error && { error }),
    };
  }
}
