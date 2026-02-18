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

/** Format token label as "Name ($SYMBOL)" or "$SYMBOL" or fallback. */
function formatTokenLabel(name: string, symbol: string, fallback: string): string {
  const sym = symbol ? `$${symbol}` : "";
  if (name && sym) return `${name} (${sym})`;
  if (sym) return sym;
  if (name) return name;
  return fallback;
}

function safeErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return String(e); } catch { return "unknown error"; }
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId.trim(), text }),
      signal: controller.signal,
    });
    let data: { ok?: boolean; description?: string };
    try {
      data = (await res.json()) as { ok?: boolean; description?: string };
    } catch (parseErr) {
      const msg = safeErrorMessage(parseErr);
      logger.warn(`[SellNotify] Telegram response not JSON: ${msg}`);
      return { ok: false, error: `invalid response: ${msg}` };
    }
    if (data?.ok) return { ok: true };
    const err = data?.description ?? `HTTP ${res.status}`;
    logger.warn(`[SellNotify] Telegram send failed: ${err}`);
    return { ok: false, error: err };
  } catch (e) {
    const msg = safeErrorMessage(e);
    logger.error(`[SellNotify] Telegram fetch failed: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  imageBuffer: Buffer,
  caption: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!botToken || !chatId.trim()) {
    return { ok: false, error: "missing bot_token or chat_id" };
  }
  const url = `${TELEGRAM_API}${botToken}/sendPhoto`;
  const form = new FormData();
  form.append("chat_id", chatId.trim());
  form.append("photo", new Blob([imageBuffer], { type: "image/png" }), "profit-card.png");
  form.append("caption", caption);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    let data: { ok?: boolean; description?: string };
    try {
      data = (await res.json()) as { ok?: boolean; description?: string };
    } catch (parseErr) {
      const msg = safeErrorMessage(parseErr);
      logger.warn(`[SellNotify] Telegram photo response not JSON: ${msg}`);
      return { ok: false, error: `invalid response: ${msg}` };
    }
    if (data?.ok) return { ok: true };
    const err = data?.description ?? `HTTP ${res.status}`;
    logger.warn(`[SellNotify] Telegram sendPhoto failed: ${err}`);
    return { ok: false, error: err };
  } catch (e) {
    const msg = safeErrorMessage(e);
    logger.error(`[SellNotify] Telegram photo fetch failed: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
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

    let sent = false;
    let error: string | undefined;
    if (success && txHash) {
      const txUrl = `${BASESCAN_TX}/${txHash}`;
      const tokenAmount = weiToEth(amountWei);
      const receivedEthStr = formatEth(receivedWei);
      const receivedEthNum = Number(receivedWei) / ETH_WEI;
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
        if (typeof holding.boughtAt === "number" && holding.boughtAt > 0) {
          const holdMs = Date.now() - holding.boughtAt;
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
