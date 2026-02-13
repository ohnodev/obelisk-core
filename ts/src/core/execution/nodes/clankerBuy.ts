/**
 * ClankerBuyNode – execute a V4 buy (ETH → token) using CabalSwapper.
 * Model only outputs token_address (or name/symbol) and optional amount_wei.
 * Pool params (pool_fee, tick_spacing, hook_address, currency0, currency1) are
 * resolved from the cached Clanker state (connect state from Blockchain Config).
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { executeSwap } from "../../../utils/cabalSwapper";

const logger = getLogger("clankerBuy");

const DEFAULT_AMOUNT_WEI = "2000000000000000"; // 0.002 ETH

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
    const privateKey = (this.getInputValue("private_key", context, undefined) as string) ?? "";
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
          const eth = getNum(amtEth);
          if (eth > 0) amountWei = String(BigInt(Math.round(eth * 1e18)));
        }
      }
    }

    if (!privateKey || privateKey.length < 20) {
      logger.warn("[ClankerBuy] No private_key (connect Wallet node or set SWAP_PRIVATE_KEY)");
      return { success: false, error: "Wallet not configured", txHash: undefined };
    }

    if (!tokenAddress && !nameOrSymbol) {
      return { success: false, error: "token_address or name/symbol required (from buy action)", txHash: undefined };
    }

    let poolFee = Number(this.getInputValue("pool_fee", context, undefined)) || 0;
    let tickSpacing = Number(this.getInputValue("tick_spacing", context, undefined)) ?? 0;
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
      process.env.RPC_URL
    );

    if (result.success) {
      logger.info(`[ClankerBuy] Swap tx: ${result.txHash}`);
    } else {
      logger.warn(`[ClankerBuy] Swap failed: ${result.error}`);
    }

    const out = {
      success: result.success,
      txHash: result.txHash,
      error: result.error,
      token_address: tokenAddress,
      amount_wei: String(amountWei),
      pool_fee: poolFee,
      tick_spacing: tickSpacing,
      hook_address: hookAddress,
      currency0,
      currency1,
    };
    return { ...out, result: out };
  }
}
