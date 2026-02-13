/**
 * Clanker blockchain service: detect V4 pool inits (Clanker hook), track swap stats, persist to JSON.
 * Run as a separate process; Obelisk nodes read the state file.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from blockchain-service/ (same dir as package.json), not cwd — so PM2 works regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { StateManager } from "./state.js";
import { BlockProcessor } from "./blockProcessor.js";
import { PERSIST_INTERVAL_MS, BLOCK_POLL_MS } from "./constants.js";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
// Store in blockchain-service/data/ (same pattern as obelisk-service); __dirname at runtime is dist/
const STATE_FILE_PATH =
  process.env.STATE_FILE_PATH ||
  path.join(path.resolve(__dirname, ".."), "data", "clanker_state.json");
const ON_SWAP_FILE_PATH =
  process.env.ON_SWAP_FILE ||
  path.join(path.resolve(__dirname, ".."), "data", "last_swap.json");
const CLANKER_HOOK_ADDRESS =
  process.env.CLANKER_HOOK_ADDRESS || "0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC";
const PERSIST_INTERVAL_SEC = Number(process.env.PERSIST_INTERVAL_SEC) || 30;
const BLOCK_POLL_MS_ENV = Number(process.env.BLOCK_POLL_MS) || BLOCK_POLL_MS;

const state = new StateManager(STATE_FILE_PATH);
console.log(`[Clanker] State file: ${STATE_FILE_PATH}`);
console.log(`[Clanker] OnSwap trigger file: ${ON_SWAP_FILE_PATH}`);
state.load();
state.startPersistInterval(PERSIST_INTERVAL_SEC * 1000);

const processor = new BlockProcessor(RPC_URL, state, CLANKER_HOOK_ADDRESS, ON_SWAP_FILE_PATH);

function shutdown(): void {
  console.log("[Clanker] Shutting down...");
  processor.stop();
  state.stopPersistInterval();
  state.persist();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

processor.start().catch((e) => {
  console.error("[Clanker] Fatal:", e);
  process.exit(1);
});
