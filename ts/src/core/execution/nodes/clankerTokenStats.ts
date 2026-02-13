/**
 * ClankerTokenStatsNode – looks up token stats from Clanker state (from BlockchainConfigNode or state_path).
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";

const logger = getLogger("clankerTokenStats");

export class ClankerTokenStatsNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const tokenAddressRaw = this.getInputValue(
      "token_address",
      context,
      undefined
    );
    const tokenAddress =
      tokenAddressRaw != null && tokenAddressRaw !== ""
        ? String(tokenAddressRaw).toLowerCase().trim()
        : undefined;

    let state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const statePath = this.getInputValue("state_path", context, undefined) as string | undefined;

    if (!state && statePath) {
      try {
        if (fs.existsSync(statePath)) {
          const raw = fs.readFileSync(statePath, "utf-8");
          state = JSON.parse(raw) as Record<string, unknown>;
        }
      } catch (e) {
        logger.warn(`[ClankerTokenStats] Failed to read state from ${abbrevPathForLog(statePath)}: ${e}`);
      }
    }

    const empty = {
      token_address: tokenAddress ?? "",
      totalSwaps: 0,
      totalBuys: 0,
      totalSells: 0,
      volume24h: 0,
      last20Swaps: [],
      launchTime: 0,
      poolId: "",
      hookAddress: "",
      feeTier: 0,
      tickSpacing: 0,
      found: false,
    };

    if (!state || !tokenAddress) {
      return { ...empty, stats: empty };
    }

    const tokens = (state.tokens as Record<string, Record<string, unknown>>) ?? {};
    const tokenData = tokens[tokenAddress];

    if (!tokenData) {
      const notFound = { ...empty, token_address: tokenAddress };
      return { ...notFound, stats: notFound };
    }

    const stats = {
      token_address: tokenAddress,
      totalSwaps: tokenData.totalSwaps ?? 0,
      totalBuys: tokenData.totalBuys ?? 0,
      totalSells: tokenData.totalSells ?? 0,
      volume24h: tokenData.volume24h ?? 0,
      last20Swaps: tokenData.last20Swaps ?? [],
      launchTime: tokenData.launchTime ?? 0,
      poolId: tokenData.poolId ?? "",
      hookAddress: tokenData.hookAddress ?? "",
      feeTier: tokenData.feeTier ?? 0,
      tickSpacing: tokenData.tickSpacing ?? 0,
      blockNumber: tokenData.blockNumber,
      transactionHash: tokenData.transactionHash,
      found: true,
    };
    return { ...stats, stats };
  }
}
