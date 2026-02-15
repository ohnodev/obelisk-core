/**
 * BuyNotifyNode – when Clanker Buy succeeds, sends a buy notification directly to Telegram
 * (amount, token, Basescan tx link). Uses TELEGRAM_BOT_TOKEN and chat_id; no TelegramAction node.
 *
 * Inputs: buy_result (from Clanker Buy), chat_id, bot_token (optional; from Text node or {{process.env.TELEGRAM_BOT_TOKEN}})
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

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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

export class BuyNotifyNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const buyResult = this.getInputValue("buy_result", context, undefined) as Record<string, unknown> | undefined;
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
    const symbol = (buyResult?.symbol as string) || (buyResult?.name as string);

    let sent = false;
    let error: string | undefined;
    if (success && txHash) {
      const ethAmount = formatEth(valueWei);
      const tokenLabel = symbol || (tokenAddress ? shortAddress(tokenAddress) : "token");
      const txUrl = `${BASESCAN_TX}/${txHash}`;
      const text = `Bought ${tokenLabel} for ${ethAmount} ETH. Tx: ${txUrl}`;
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
