/**
 * BuyNotifyNode – when Clanker Buy succeeds, sends a buy notification to Telegram
 * with a shareable profit card image.
 *
 * Inputs: buy_result (from Clanker Buy), state (optional; for MC and token name/symbol), chat_id,
 *         bot_token (optional; from Text node or {{process.env.TELEGRAM_BOT_TOKEN}})
 * Outputs: sent (boolean), chat_id, error (if send failed)
 */
import { formatEther } from "ethers";
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

const logger = getLogger("buyNotify");
const BASESCAN_TX = "https://basescan.org/tx";

/** Format wei as human-readable ETH with no trailing zeros. */
function formatEth(wei: string | bigint): string {
  try {
    const weiValue = typeof wei === "bigint" ? wei : BigInt(wei);
    let s = formatEther(weiValue);
    if (s.includes(".")) {
      s = s.replace(/0+$/, "");
      if (s.endsWith(".")) s = s.slice(0, -1);
    }
    return s;
  } catch {
    return "0";
  }
}

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** MC in ETH from lastPrice * (totalSupply / 10^decimals). */
function formatMcEth(state: Record<string, unknown> | undefined, tokenAddress: string): string | null {
  if (!state?.tokens || typeof state.tokens !== "object") return null;
  const t = (state.tokens as Record<string, Record<string, unknown>>)[tokenAddress.toLowerCase()];
  if (!t) return null;
  const price = getNum(t.lastPrice);
  const supply = getNum(t.totalSupply);
  const decimals = Math.min(18, Math.max(0, getNum(t.decimals) || 18));
  if (price <= 0 || supply <= 0) return null;
  const mcEth = price * (supply / Math.pow(10, decimals));
  if (mcEth < 0.0001) return mcEth.toFixed(6);
  if (mcEth < 1) return mcEth.toFixed(4);
  return mcEth.toFixed(2);
}

export class BuyNotifyNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const buyResult = this.getInputValue("buy_result", context, undefined) as Record<string, unknown> | undefined;
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

    const success = buyResult?.success === true;
    const txHash = buyResult?.txHash as string | undefined;
    const tokenAddress = (buyResult?.token_address as string) ?? "";
    const valueWei = (buyResult?.value_wei as string) ?? (buyResult?.amount_wei as string) ?? "0";
    const name = (buyResult?.name as string)?.trim() || "";
    const symbol = (buyResult?.symbol as string)?.trim() || "";
    const tokenLabel = formatTokenLabel(name, symbol, tokenAddress || "token");

    let sent = false;
    let error: string | undefined;
    if (success && txHash) {
      const costEthStr = formatEth(valueWei);
      const costEthNum = getNum(valueWei) / 1e18;
      const txUrl = `${BASESCAN_TX}/${txHash}`;
      const mcStr = formatMcEth(state, tokenAddress);

      const caption = [
        `🟢 Bought ${tokenLabel}`,
        `Cost: ${costEthStr} ETH`,
        ...(tokenAddress ? [`CA: ${tokenAddress}`] : []),
        ...(mcStr ? [`MC: ${mcStr} ETH`] : []),
        `Tx: ${txUrl}`,
      ].join("\n");

      let ethUsdPrice = 0;
      try { ethUsdPrice = await fetchEthUsdPrice(); } catch { /* non-critical */ }

      try {
        const cardData: ProfitCardData = {
          tokenName: symbol || name || "TOKEN",
          chain: "BASE",
          action: "BUY",
          profitPercent: 0,
          initialEth: costEthNum,
          positionEth: costEthNum,
          ...(ethUsdPrice > 0 ? { ethUsdPrice } : {}),
        };
        const imageBuffer = await generateProfitCard(cardData);
        const photoResult = await sendTelegramPhoto(botToken, chatId, imageBuffer, caption);
        if (photoResult.ok) {
          sent = true;
        } else {
          logger.warn(`[BuyNotify] Photo send failed (${photoResult.error}), falling back to text`);
          const textResult = await sendTelegramMessage(botToken, chatId, caption);
          sent = textResult.ok;
          error = textResult.error;
        }
      } catch (cardErr) {
        logger.warn(`[BuyNotify] Profit card generation failed, falling back to text: ${safeErrorMessage(cardErr)}`);
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
