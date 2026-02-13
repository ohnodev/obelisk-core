/**
 * Sell only the given token addresses. Pool info is read from clanker_state.json.
 * Tokens must exist in state (blockchain-service tracks Clanker pools).
 *
 * Run from obelisk-core root:
 *   SELL_TOKENS=0xabc...,0xdef...,0x123... npx tsx ts/scripts/sell-specific-tokens.ts
 *
 * Or pass as first 3 args:
 *   npx tsx ts/scripts/sell-specific-tokens.ts 0xabc... 0xdef... 0x123...
 *
 * Env: SWAP_PRIVATE_KEY, RPC_URL, STATE_PATH (optional), SELL_TOKENS (comma-separated)
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

function getTokensToSell(): string[] {
  const fromEnv = (process.env.SELL_TOKENS ?? "").trim();
  if (fromEnv) {
    return fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const args = process.argv.slice(2).filter((a) => a.startsWith("0x"));
  return args;
}

async function getTokenBalance(
  provider: ethers.Provider,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return contract.balanceOf(walletAddress) as Promise<bigint>;
}

function findTokenInState(state: ClankerState, wantAddress: string): StateToken | null {
  const want = wantAddress.toLowerCase();
  const tokens = state.tokens ?? {};
  if (tokens[want]) return tokens[want];
  if (tokens[wantAddress]) return tokens[wantAddress];
  for (const [key, t] of Object.entries(tokens)) {
    const addr = (t.tokenAddress ?? key).toString().toLowerCase();
    if (addr === want) return t;
  }
  return null;
}

async function main(): Promise<void> {
  const tokensToSell = getTokensToSell();
  if (tokensToSell.length === 0) {
    console.error("No tokens given. Set SELL_TOKENS=0x...,0x... or pass addresses as args.");
    process.exit(1);
  }

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

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const walletAddress = await wallet.getAddress();

  console.log(`Selling ${tokensToSell.length} token(s) for wallet ${walletAddress}...`);
  let sold = 0;
  let failed = 0;

  for (const rawAddr of tokensToSell) {
    const tokenAddress = rawAddr.startsWith("0x") ? rawAddr : `0x${rawAddr}`;
    if (!ethers.isAddress(tokenAddress)) {
      console.warn(`  Skip ${tokenAddress}: invalid address`);
      failed++;
      continue;
    }

    const t = findTokenInState(state, tokenAddress);
    if (!t) {
      console.warn(`  Skip ${tokenAddress}: not found in clanker state (no pool info)`);
      failed++;
      continue;
    }

    const currency0 = String(t.currency0 ?? "").trim();
    const currency1 = String(t.currency1 ?? "").trim();
    if (!currency0 || !currency1) {
      console.warn(`  Skip ${tokenAddress}: missing currency0/currency1 in state`);
      failed++;
      continue;
    }

    let balanceWei: bigint;
    try {
      balanceWei = await getTokenBalance(provider, tokenAddress, walletAddress);
    } catch (e) {
      console.warn(`  Skip ${tokenAddress}: failed to read balance: ${e}`);
      failed++;
      continue;
    }
    if (balanceWei === 0n) {
      console.log(`  Skip ${tokenAddress}: zero balance`);
      continue;
    }

    const poolFee = Number(t.feeTier) || 0;
    const tickSpacing = Number(t.tickSpacing) || 0;
    const hookAddress = String(t.hookAddress ?? "").trim();

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
