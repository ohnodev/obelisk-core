/**
 * SellAllBagsNode – sell every position in clanker_bags.json (same logic as sell-all-bags script).
 * Inputs: trigger/request_id from sell_bags_listener, storage_instance, state, wallet (private_key).
 * Outputs: success, sold_count, errors, response_body (for HTTP), request_id, status_code.
 */
import fs from "fs";
import { ethers } from "ethers";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { executeSwap } from "../../../utils/cabalSwapper";
import { resolveBagsPath } from "./clankerStoragePath";
import type { ClankerBagState, BagHolding } from "./clankerBags";

const logger = getLogger("sellAllBags");
const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];
const DEFAULT_RPC = "https://mainnet.base.org";

async function getTokenBalance(
  provider: ethers.Provider,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return contract.balanceOf(walletAddress) as Promise<bigint>;
}

export class SellAllBagsNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const requestId = (this.getInputValue("request_id", context, "") as string) ?? "";
    const privateKey =
      (this.getInputValue("private_key", context, undefined) as string) ??
      this.resolveEnvVar(this.metadata.private_key) ??
      process.env.SWAP_PRIVATE_KEY ??
      "";
    const rpcUrl =
      (this.getInputValue("rpc_url", context, undefined) as string)?.trim() ||
      process.env.RPC_URL ||
      DEFAULT_RPC;

    const bagsPath = resolveBagsPath(this, context);
    if (!bagsPath || !fs.existsSync(bagsPath)) {
      const body = { error: "Bags file not found", sold_count: 0, failed_count: 0 };
      return {
        success: false,
        sold_count: 0,
        errors: [body.error],
        response_body: body,
        request_id: requestId,
        status_code: 404,
      };
    }

    if (!privateKey || privateKey.length < 20) {
      const body = { error: "Wallet not configured", sold_count: 0, failed_count: 0 };
      return {
        success: false,
        sold_count: 0,
        errors: [body.error],
        response_body: body,
        request_id: requestId,
        status_code: 500,
      };
    }

    let bagState: ClankerBagState;
    try {
      const raw = fs.readFileSync(bagsPath, "utf-8");
      bagState = JSON.parse(raw) as ClankerBagState;
    } catch (e) {
      const body = { error: "Failed to read bags file", sold_count: 0, failed_count: 0 };
      return {
        success: false,
        sold_count: 0,
        errors: [String(e)],
        response_body: body,
        request_id: requestId,
        status_code: 500,
      };
    }

    const holdings = bagState.holdings ?? {};
    const entries = Object.entries(holdings);
    if (entries.length === 0) {
      const body = { sold_count: 0, failed_count: 0, message: "No bags to sell" };
      return {
        success: true,
        sold_count: 0,
        errors: [],
        response_body: body,
        request_id: requestId,
        status_code: 200,
      };
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const walletAddress = await wallet.getAddress();

    let sold = 0;
    let failed = 0;
    const errors: string[] = [];
    let updated = false;

    for (const [key, holding] of entries) {
      const h = holding as BagHolding;
      const tokenAddress = (h.tokenAddress ?? key).startsWith("0x")
        ? (h.tokenAddress ?? key)
        : `0x${h.tokenAddress ?? key}`;

      let balanceWei: bigint;
      try {
        balanceWei = await getTokenBalance(provider, tokenAddress, walletAddress);
      } catch (e) {
        errors.push(`${tokenAddress}: ${e}`);
        failed++;
        continue;
      }
      if (balanceWei === 0n) continue;

      const result = await executeSwap(
        privateKey,
        {
          tokenAddress,
          amountWei: String(balanceWei),
          isBuy: false,
          poolFee: h.poolFee,
          tickSpacing: h.tickSpacing,
          hookAddress: h.hookAddress,
          currency0: h.currency0,
          currency1: h.currency1,
        },
        rpcUrl
      );

      if (result.success) {
        sold++;
        delete bagState.holdings[key];
        bagState.lastUpdated = Date.now();
        updated = true;
        logger.info(`[SellAllBags] Sold ${tokenAddress} tx=${result.txHash}`);
      } else {
        failed++;
        errors.push(`${tokenAddress}: ${result.error ?? "unknown"}`);
      }
    }

    if (updated) {
      try {
        fs.writeFileSync(bagsPath, JSON.stringify(bagState, null, 2), "utf-8");
      } catch (err) {
        logger.error(`[SellAllBags] Failed to write bags: ${err}`);
        errors.push(`Write bags: ${err}`);
      }
    }

    const response_body = {
      sold_count: sold,
      failed_count: failed,
      total_processed: sold + failed,
      errors: errors.length ? errors : undefined,
    };

    return {
      success: failed === 0,
      sold_count: sold,
      errors,
      response_body,
      request_id: requestId,
      status_code: 200,
    };
  }
}
