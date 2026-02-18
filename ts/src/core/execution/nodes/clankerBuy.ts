/**
 * ClankerBuyNode – execute a V4 buy (ETH → token) using CabalSwapper.
 * Model only outputs token_address (or name/symbol) and optional amount_wei.
 * Pool params (pool_fee, tick_spacing, hook_address, currency0, currency1) are
 * resolved from the cached Clanker state (connect state from Blockchain Config).
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { executeSwap } from "../../../utils/cabalSwapper";
import { resolveActionsPath } from "./clankerStoragePath";

const logger = getLogger("clankerBuy");

const DEFAULT_AMOUNT_WEI = "1000000000000000"; // 0.001 ETH
const DEFAULT_RPC_URL = "https://mainnet.base.org";
const DEFAULT_COOLDOWN_MINUTES = 30;

function getActions(value: unknown): Array<{ action: string; params: Record<string, unknown> }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { action: string; params: Record<string, unknown> } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as any).action === "string" &&
      typeof (item as any).params === "object"
  );
}

function getStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}
function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert ETH amount (string or number) to wei as decimal string.
 * Avoids IEEE-754 precision loss by doing string/decimal shift instead of float * 1e18.
 * Null/empty/invalid → "0". Downstream expects wei as string (e.g. BigInt(wei)).
 */
function ethToWei(eth: unknown): string {
  if (eth == null) return "0";
  const s = String(eth).trim();
  if (s === "" || s === "-") return "0";
  const parts = s.replace(/,/g, "").split(".");
  if (parts.length > 2) return "0";
  const intPart = (parts[0] || "0").replace(/\D/g, "") || "0";
  let fracPart = (parts[1] || "").replace(/\D/g, "").slice(0, 18);
  fracPart = fracPart.padEnd(18, "0");
  const combined = intPart + fracPart;
  if (combined === "0" || /^0+$/.test(combined)) return "0";
  return BigInt(combined).toString();
}

/**
 * Check if a token was bought or sold within the cooldown window.
 * Returns the minutes since last trade, or null if no recent trade found.
 */
function checkCooldown(actionsPath: string, tokenAddress: string, cooldownMs: number): { onCooldown: boolean; minutesAgo: number } | null {
  if (!actionsPath || !tokenAddress) return null;
  try {
    if (!fs.existsSync(actionsPath)) return null;
    const raw = fs.readFileSync(actionsPath, "utf-8");
    const data = JSON.parse(raw);
    const list: Array<{ type?: string; tokenAddress?: string; timestamp?: number }> = Array.isArray(data) ? data : (data?.actions ?? []);
    const addr = tokenAddress.toLowerCase();
    const now = Date.now();
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      if (!entry || !entry.tokenAddress || !entry.timestamp) continue;
      if (entry.tokenAddress.toLowerCase() !== addr) continue;
      if (entry.type !== "buy" && entry.type !== "sell") continue;
      const elapsed = now - entry.timestamp;
      if (elapsed < cooldownMs) {
        return { onCooldown: true, minutesAgo: Math.round(elapsed / 60_000) };
      }
      return null;
    }
  } catch (err) {
    logger.debug(`[ClankerBuy] Failed to read actions for cooldown check (${tokenAddress}): ${err instanceof Error ? err.message : err}`);
  }
  return null;
}

/** Find token in state by address, or by name/symbol (case-insensitive). */
function findTokenInState(
  state: Record<string, unknown> | undefined,
  tokenAddress: string,
  nameOrSymbol: string
): { address: string; feeTier: number; tickSpacing: number; hookAddress: string; currency0: string; currency1: string } | null {
  const tokens = (state?.tokens as Record<string, Record<string, unknown>>) ?? {};
  if (!Object.keys(tokens).length) return null;

  // 1) Exact address lookup
  const byAddr = tokenAddress && tokens[tokenAddress.toLowerCase()];
  if (byAddr) {
    return {
      address: getStr(byAddr.tokenAddress) || tokenAddress,
      feeTier: getNum(byAddr.feeTier),
      tickSpacing: getNum(byAddr.tickSpacing),
      hookAddress: getStr(byAddr.hookAddress),
      currency0: getStr(byAddr.currency0),
      currency1: getStr(byAddr.currency1),
    };
  }

  // 2) By name or symbol
  if (nameOrSymbol) {
    const q = nameOrSymbol.toLowerCase();
    for (const [addr, t] of Object.entries(tokens)) {
      if (getStr(t.name).toLowerCase() === q || getStr(t.symbol).toLowerCase() === q) {
        return {
          address: getStr(t.tokenAddress) || addr,
          feeTier: getNum(t.feeTier),
          tickSpacing: getNum(t.tickSpacing),
          hookAddress: getStr(t.hookAddress),
          currency0: getStr(t.currency0),
          currency1: getStr(t.currency1),
        };
      }
    }
  }

  return null;
}

export class ClankerBuyNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const privateKey =
      (this.getInputValue("private_key", context, undefined) as string) ??
      this.resolveEnvVar(this.metadata.private_key) ??
      process.env.SWAP_PRIVATE_KEY ??
      "";
    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const tgActions = getActions(this.getInputValue("tg_actions", context, undefined));

    let tokenAddress = getStr(this.getInputValue("token_address", context, undefined));
    let amountWei = getStr(this.getInputValue("amount_wei", context, undefined)) ||
      getStr(this.getInputValue("amount", context, undefined)) ||
      getStr(this.metadata.amount_wei) ||
      DEFAULT_AMOUNT_WEI;
    let nameOrSymbol = "";

    if (tgActions.length > 0) {
      const buyAction = tgActions.find((a) => String(a.action).toLowerCase() === "buy");
      if (buyAction?.params) {
        const p = buyAction.params;
        tokenAddress = getStr(p.token_address ?? p.tokenAddress) || tokenAddress;
        nameOrSymbol = getStr(p.name ?? p.symbol ?? "");
        const amtWei = getStr(p.amount_wei ?? p.amountWei ?? p.amount);
        const amtEth = p.amount_eth ?? p.amountEth;
        if (amtWei) amountWei = amtWei;
        else if (amtEth !== undefined && amtEth !== null && amtEth !== "") {
          const weiStr = ethToWei(amtEth);
          if (weiStr !== "0") amountWei = weiStr;
        }
      }
    }

    const rpcUrl =
      getStr(this.getInputValue("rpc_url", context, undefined)) ||
      getStr(this.resolveEnvVar(this.metadata.rpc_url)) ||
      process.env.RPC_URL ||
      DEFAULT_RPC_URL;

    if (!privateKey || privateKey.length < 20) {
      logger.warn("[ClankerBuy] No private_key (connect Wallet node or set SWAP_PRIVATE_KEY)");
      return { success: false, error: "Wallet not configured", txHash: undefined };
    }

    if (!tokenAddress && !nameOrSymbol) {
      return { success: false, error: "token_address or name/symbol required (from buy action)", txHash: undefined };
    }

    let poolFee = Number(this.getInputValue("pool_fee", context, undefined)) || 0;
    let tickSpacing = getNum(this.getInputValue("tick_spacing", context, undefined));
    let hookAddress = getStr(this.getInputValue("hook_address", context, undefined)) || "0x0000000000000000000000000000000000000000";
    let currency0 = getStr(this.getInputValue("currency0", context, undefined));
    let currency1 = getStr(this.getInputValue("currency1", context, undefined));

    // If state connected: resolve pool params from cache (model only sends token identifier)
    if (state && (tokenAddress || nameOrSymbol)) {
      const resolved = findTokenInState(state, tokenAddress, nameOrSymbol);
      if (resolved) {
        poolFee = resolved.feeTier || 0;
        tickSpacing = resolved.tickSpacing ?? 0;
        hookAddress = resolved.hookAddress || "0x0000000000000000000000000000000000000000";
        currency0 = resolved.currency0;
        currency1 = resolved.currency1;
        tokenAddress = resolved.address;
      } else {
        logger.warn("[ClankerBuy] Token not in cache (use token_address from recent launches or name/symbol)");
        return {
          success: false,
          error: "Token not in cache (not a recent launch or state not connected)",
          txHash: undefined,
          token_address: tokenAddress || nameOrSymbol,
        };
      }
    } else if (!tokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      return { success: false, error: "token_address required (or connect state and use name/symbol)", txHash: undefined };
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      return { success: false, error: "Resolved token address invalid", txHash: undefined, token_address: tokenAddress };
    }

    // ── No-rebuy cooldown check ──
    const rawInput = this.getInputValue("rebuy_cooldown_minutes", context, undefined);
    const rawMeta = this.metadata.rebuy_cooldown_minutes;
    const rawCooldown = rawInput ?? rawMeta;
    let cooldownMinutes = DEFAULT_COOLDOWN_MINUTES;
    if (rawCooldown != null && String(rawCooldown).trim() !== "") {
      const parsed = Number(rawCooldown);
      cooldownMinutes = Number.isFinite(parsed) ? parsed : DEFAULT_COOLDOWN_MINUTES;
    }
    const actionsPath = resolveActionsPath(this, context);
    if (actionsPath && cooldownMinutes > 0) {
      const cd = checkCooldown(actionsPath, tokenAddress, cooldownMinutes * 60_000);
      if (cd?.onCooldown) {
        logger.info(`[ClankerBuy] Token ${tokenAddress} on cooldown (traded ${cd.minutesAgo}m ago, cooldown=${cooldownMinutes}m) — skipping`);
        return {
          success: false,
          error: `Token on cooldown (traded ${cd.minutesAgo}m ago, cooldown ${cooldownMinutes}m)`,
          skipped: true,
          txHash: undefined,
          token_address: tokenAddress,
        };
      }
    }

    const result = await executeSwap(
      privateKey,
      {
        tokenAddress,
        amountWei: String(amountWei),
        isBuy: true,
        poolFee,
        tickSpacing,
        hookAddress: hookAddress || undefined,
        currency0: currency0 || undefined,
        currency1: currency1 || undefined,
      },
      rpcUrl
    );

    if (result.success) {
      logger.info(`[ClankerBuy] Swap tx: ${result.txHash}`);
    } else {
      logger.warn(`[ClankerBuy] Swap failed: ${result.error}`);
    }

    let name = "";
    let symbol = "";
    if (state?.tokens && typeof state.tokens === "object") {
      const t = (state.tokens as Record<string, Record<string, unknown>>)[tokenAddress.toLowerCase()];
      if (t) {
        name = getStr(t.name);
        symbol = getStr(t.symbol);
      }
    }
    const out = {
      success: result.success,
      txHash: result.txHash,
      error: result.error,
      token_address: tokenAddress,
      amount_wei: result.tokensReceived != null && result.tokensReceived !== "" ? String(result.tokensReceived) : String(amountWei),
      value_wei: String(amountWei), // ETH spent (for notifications); amount_wei above is tokens received when swap succeeds
      pool_fee: poolFee,
      tick_spacing: tickSpacing,
      hook_address: hookAddress,
      currency0,
      currency1,
      ...(name && { name }),
      ...(symbol && { symbol }),
    };
    return { ...out, result: out };
  }
}
