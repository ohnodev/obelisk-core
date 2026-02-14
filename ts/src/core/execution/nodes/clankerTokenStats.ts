/**
 * ClankerTokenStatsNode – looks up token stats from Clanker state (from Blockchain Config).
 */
import { BaseNode, ExecutionContext } from "../nodeBase";

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

    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;

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
