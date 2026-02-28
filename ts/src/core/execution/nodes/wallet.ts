/**
 * WalletNode – resolves private key from inputs, metadata.private_key, or SWAP_PRIVATE_KEY env
 * for internal checks. Does not expose private_key in output; downstream nodes (ClankerBuy,
 * ClankerSell, BalanceChecker) must read the key from metadata.private_key or SWAP_PRIVATE_KEY.
 * Hook up to Buy/Sell so the graph knows wallet is required; they read the key themselves.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { Wallet } from "ethers";

const logger = getLogger("wallet");

export class WalletNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const privateKey =
      (this.getInputValue("private_key", context, undefined) as string) ??
      this.resolveEnvVar(this.metadata.private_key) ??
      process.env.SWAP_PRIVATE_KEY ??
      "";

    const walletReady = !!privateKey && privateKey.length >= 20;
    let walletAddress = "";

    if (!walletReady) {
      logger.debug("[Wallet] SWAP_PRIVATE_KEY not set or too short");
    } else {
      try {
        walletAddress = new Wallet(privateKey).address;
      } catch (error) {
        logger.debug(
          `[Wallet] Failed to derive wallet address: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      private_key: privateKey,
      wallet_address: walletAddress,
      wallet_ready: walletReady,
    };
  }
}
