/**
 * BuyNotifyNode – when Clanker Buy succeeds, sends a buy notification to Telegram.
 * Formatted with token name/symbol, cost (ETH), optional MC at buy (from state), and Basescan tx link.
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

const logger = getLogger("buyNotify");
const BASESCAN_TX = "https://basescan.org/tx";
const TELEGRAM_API = "https://api.telegram.org/bot";

/** Format wei as human-readable ETH (e.g. "0", "0.002", "0.00001") with no trailing zeros. */
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
  try {
    return String(e);
  } catch {
    return "unknown error";
  }
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
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId.trim(), text }),
      signal: AbortSignal.timeout(10_000),
    });
    let data: { ok?: boolean; description?: string };
    try {
      data = (await res.json()) as { ok?: boolean; description?: string };
    } catch (parseErr) {
      const msg = safeErrorMessage(parseErr);
      logger.warn(`[BuyNotify] Telegram response not JSON: ${msg}`);
      return { ok: false, error: `invalid response: ${msg}` };
    }
    if (data?.ok) return { ok: true };
    const err = data?.description ?? `HTTP ${res.status}`;
    logger.warn(`[BuyNotify] Telegram send failed: ${err}`);
    return { ok: false, error: err };
  } catch (e) {
    const msg = safeErrorMessage(e);
    logger.error(`[BuyNotify] Telegram fetch failed: ${msg}`);
    return { ok: false, error: msg };
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

    const success = buyResult?.success === true;
    const txHash = buyResult?.txHash as string | undefined;
    const tokenAddress = (buyResult?.token_address as string) ?? "";
    const valueWei = (buyResult?.value_wei as string) ?? (buyResult?.amount_wei as string) ?? "0"; // ETH spent (value_wei from ClankerBuy)
    const name = (buyResult?.name as string)?.trim() || "";
    const symbol = (buyResult?.symbol as string)?.trim() || "";
    const tokenLabel = formatTokenLabel(name, symbol, tokenAddress || "token");

    let sent = false;
    let error: string | undefined;
    if (success && txHash) {
      const costEth = formatEth(valueWei);
      const txUrl = `${BASESCAN_TX}/${txHash}`;
      const mcStr = formatMcEth(state, tokenAddress);
      const lines = [
        `🟢 Bought ${tokenLabel}`,
        `Cost: ${costEth} ETH`,
        ...(tokenAddress ? [`CA: ${tokenAddress}`] : []),
        ...(mcStr ? [`MC: ${mcStr} ETH`] : []),
        `Tx: ${txUrl}`,
      ];
      const text = lines.join("\n");
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
