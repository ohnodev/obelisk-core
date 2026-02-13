/**
 * WalletNode – resolves private key from inputs, metadata.private_key, or SWAP_PRIVATE_KEY env
 * for internal checks. Does not expose private_key in output; downstream nodes (ClankerBuy,
 * ClankerSell, BalanceChecker) must read the key from metadata.private_key or SWAP_PRIVATE_KEY.
 * Hook up to Buy/Sell so the graph knows wallet is required; they read the key themselves.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("wallet");

export class WalletNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const privateKey =
      (this.getInputValue("private_key", context, undefined) as string) ??
      this.resolveEnvVar(this.metadata.private_key) ??
      process.env.SWAP_PRIVATE_KEY ??
      "";

    const walletReady = !!privateKey && privateKey.length >= 20;

    if (!walletReady) {
      logger.debug("[Wallet] SWAP_PRIVATE_KEY not set or too short");
    }

    return { wallet_ready: walletReady };
  }
}
