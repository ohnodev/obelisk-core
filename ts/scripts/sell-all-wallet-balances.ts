/**
 * Sell ALL token balances in the wallet using pool info from clanker_state.json.
 * Iterates every token in state.tokens, checks wallet balance; if > 0, sells via CabalSwapper.
 * Use when bags file is empty or you want to dump every Clanker token the wallet holds.
 *
 * Run from obelisk-core root:
 *   npx tsx ts/scripts/sell-all-wallet-balances.ts
 *
 * Env: SWAP_PRIVATE_KEY, RPC_URL, STATE_PATH (optional; default blockchain-service/data/clanker_state.json)
 */
import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";

const root = path.resolve(__dirname, "..", "..");
for (const rel of [".env", path.join("blockchain-service", ".env")]) {
  const envPath = path.join(root, rel);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

import { ethers } from "ethers";
import { executeSwap } from "../src/utils/cabalSwapper";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

type StateToken = {
  tokenAddress?: string;
  currency0?: string;
  currency1?: string;
  hookAddress?: string;
  feeTier?: number;
  tickSpacing?: number;
};

type ClankerState = {
  tokens?: Record<string, StateToken>;
};

function resolveStatePath(): string {
  const envPath = process.env.STATE_PATH?.trim();
  if (envPath) {
    const expanded = envPath.startsWith("~/")
      ? path.join(os.homedir(), envPath.slice(2))
      : path.resolve(envPath);
    return expanded;
  }
  const defaults = [
    path.join(root, "blockchain-service", "data", "clanker_state.json"),
    path.join(process.cwd(), "blockchain-service", "data", "clanker_state.json"),
  ];
  for (const p of defaults) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(root, "blockchain-service", "data", "clanker_state.json");
}

async function getTokenBalance(
  provider: ethers.Provider,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return contract.balanceOf(walletAddress) as Promise<bigint>;
}

async function main(): Promise<void> {
  const privateKey = (process.env.SWAP_PRIVATE_KEY ?? "").trim();
  const rpcUrl = process.env.RPC_URL ?? "https://mainnet.base.org";
  if (!privateKey || privateKey.length < 64) {
    console.error("SWAP_PRIVATE_KEY is not set or invalid. Set it in blockchain-service/.env or .env");
    process.exit(1);
  }

  const statePath = resolveStatePath();
  if (!fs.existsSync(statePath)) {
    console.error("Clanker state file not found:", statePath);
    process.exit(1);
  }

  let state: ClankerState;
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    state = JSON.parse(raw) as ClankerState;
  } catch (e) {
    console.error("Failed to read state file:", e);
    process.exit(1);
  }

  const tokens = state.tokens ?? {};
  const tokenEntries = Object.entries(tokens);
  if (tokenEntries.length === 0) {
    console.log("No tokens in state. Exiting.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const walletAddress = await wallet.getAddress();

  console.log(`Checking wallet ${walletAddress} for ${tokenEntries.length} tokens from state...`);
  const toSell: { tokenAddress: string; balanceWei: bigint; t: StateToken }[] = [];

  for (const [addr, t] of tokenEntries) {
    const tokenAddress = (t.tokenAddress ?? addr).trim();
    if (!ethers.isAddress(tokenAddress)) continue;
    try {
      const balanceWei = await getTokenBalance(provider, tokenAddress, walletAddress);
      if (balanceWei > 0n) toSell.push({ tokenAddress, balanceWei, t });
    } catch (_) {
      // skip if balance check fails (e.g. not ERC20)
    }
  }

  if (toSell.length === 0) {
    console.log("No token balances to sell. Done.");
    return;
  }

  console.log(`Selling ${toSell.length} token(s) with balance > 0...`);
  let sold = 0;
  let failed = 0;

  for (const { tokenAddress, balanceWei, t } of toSell) {
    const poolFee = Number(t.feeTier) || 0;
    const tickSpacing = Number(t.tickSpacing) ?? 0;
    const hookAddress = String(t.hookAddress ?? "").trim();
    const currency0 = String(t.currency0 ?? "").trim();
    const currency1 = String(t.currency1 ?? "").trim();

    if (!currency0 || !currency1) {
      console.warn(`  Skip ${tokenAddress}: missing currency0/currency1 in state`);
      failed++;
      continue;
    }

    console.log(`  Selling ${tokenAddress} (${balanceWei} wei)...`);
    const result = await executeSwap(privateKey, {
      tokenAddress,
      amountWei: String(balanceWei),
      isBuy: false,
      poolFee,
      tickSpacing,
      hookAddress: hookAddress || undefined,
      currency0,
      currency1,
    }, rpcUrl);

    if (result.success) {
      sold++;
      console.log(`    Sold. Tx: ${result.txHash}`);
    } else {
      failed++;
      console.warn(`    Failed: ${result.error}${result.txHash ? ` (tx: ${result.txHash})` : ""}`);
    }
  }

  console.log(`Done. Sold ${sold}, failed ${failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
