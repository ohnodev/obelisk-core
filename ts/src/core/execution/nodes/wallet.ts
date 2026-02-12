/**
 * WalletNode – reads SWAP_PRIVATE_KEY from process.env and passes it downstream.
 * Hook up to Buy (or Sell) node so the swap uses this wallet.
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

    return {
      private_key: privateKey,
      wallet_ready: walletReady,
    };
  }
}
