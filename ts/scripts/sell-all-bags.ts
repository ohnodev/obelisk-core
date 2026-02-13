/**
 * Standalone script: sell every position in clanker_bags.json one by one.
 * Uses SWAP_PRIVATE_KEY and RPC_URL (load from .env). After each successful sell,
 * removes that holding from the bags file.
 *
 * Run from obelisk-core root:
 *   npx tsx ts/scripts/sell-all-bags.ts
 * Or with explicit env:
 *   BAGS_PATH=/path/to/clanker_bags.json npx tsx ts/scripts/sell-all-bags.ts
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load .env from obelisk-core root and blockchain-service
const root = path.resolve(__dirname, "..", "..");
for (const rel of [".env", path.join("blockchain-service", ".env")]) {
  const envPath = path.join(root, rel);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

import { ethers } from "ethers";
import { executeSwap } from "../src/utils/cabalSwapper";
import type { ClankerBagState, BagHolding } from "../src/core/execution/nodes/clankerBags";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

async function getTokenBalance(
  provider: ethers.Provider,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return contract.balanceOf(walletAddress) as Promise<bigint>;
}

function resolveBagsPath(): string {
  if (process.env.BAGS_PATH && fs.existsSync(process.env.BAGS_PATH)) {
    return path.resolve(process.env.BAGS_PATH);
  }
  if (process.env.STATE_PATH) {
    const dir = path.dirname(process.env.STATE_PATH);
    const candidate = path.join(dir, "clanker_bags.json");
    if (fs.existsSync(candidate)) return candidate;
  }
  const defaults = [
    path.join(root, "blockchain-service", "data", "clanker_bags.json"),
    path.join(process.cwd(), "blockchain-service", "data", "clanker_bags.json"),
  ];
  for (const p of defaults) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(root, "blockchain-service", "data", "clanker_bags.json");
}

async function main(): Promise<void> {
  const privateKey = (process.env.SWAP_PRIVATE_KEY ?? "").trim();
  const rpcUrl = process.env.RPC_URL ?? "https://mainnet.base.org";
  if (!privateKey || privateKey.length < 64) {
    console.error("SWAP_PRIVATE_KEY is not set or invalid. Set it in blockchain-service/.env or .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const walletAddress = await wallet.getAddress();

  const bagPath = resolveBagsPath();
  if (!fs.existsSync(bagPath)) {
    console.error("Bags file not found:", bagPath);
    process.exit(1);
  }

  let bagState: ClankerBagState;
  try {
    const raw = fs.readFileSync(bagPath, "utf-8");
    bagState = JSON.parse(raw) as ClankerBagState;
  } catch (e) {
    console.error("Failed to read bags file:", e);
    process.exit(1);
  }

  const holdings = bagState.holdings ?? {};
  const entries = Object.entries(holdings);
  if (entries.length === 0) {
    console.log("No bags to sell. Exiting.");
    return;
  }

  console.log(`Found ${entries.length} bag(s). Selling one by one (using wallet balance, not bag amount)...`);
  let sold = 0;
  let failed = 0;
  let updated = false;

  for (const [key, holding] of entries) {
    const h = holding as BagHolding;
    const tokenAddress = (h.tokenAddress ?? key).startsWith("0x") ? (h.tokenAddress ?? key) : `0x${h.tokenAddress ?? key}`;

    // Use wallet's actual token balance so we sell ALL tokens (bag stores ETH spent on buy, not token amount)
    let balanceWei: bigint;
    try {
      balanceWei = await getTokenBalance(provider, tokenAddress, walletAddress);
    } catch (e) {
      console.error(`  ${tokenAddress}: failed to read balance: ${e}`);
      failed += 1;
      continue;
    }
    if (balanceWei === 0n) {
      console.log(`  Skip ${tokenAddress}: zero balance (left in bags).`);
      continue;
    }

    console.log(`Selling ${tokenAddress} (balance ${balanceWei} wei)...`);
    const result = await executeSwap(privateKey, {
      tokenAddress,
      amountWei: String(balanceWei),
      isBuy: false,
      poolFee: h.poolFee,
      tickSpacing: h.tickSpacing,
      hookAddress: h.hookAddress,
      currency0: h.currency0,
      currency1: h.currency1,
    }, rpcUrl);

    if (result.success) {
      sold++;
      delete bagState.holdings[key];
      bagState.lastUpdated = Date.now();
      updated = true;
      console.log(`  Sold. Tx: ${result.txHash}. Removed from bags.`);
    } else {
      failed++;
      console.warn(`  Failed: ${result.error}${result.txHash ? ` (tx: ${result.txHash})` : ""}`);
    }
  }

  if (updated) {
    try {
      fs.writeFileSync(bagPath, JSON.stringify(bagState, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to persist bagState", err);
      process.exit(1);
    }
  }

  console.log(`Done. Sold ${sold}, failed ${failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
