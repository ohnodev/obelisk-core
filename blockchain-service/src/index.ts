/**
 * Clanker blockchain service: detect V4 pool inits (Clanker hook), track swap stats, persist to JSON.
 * Exposes read-only HTTP API for workflows; Obelisk nodes fetch state from the API.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from blockchain-service/ (same dir as package.json), not cwd — so PM2 works regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import express from "express";
import { StateManager } from "./state.js";
import { BlockProcessor } from "./blockProcessor.js";
import { PERSIST_INTERVAL_MS, BLOCK_POLL_MS, CLEANUP_INTERVAL_MS, CLEANUP_MIN_VOLUME_ETH } from "./constants.js";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
// Store in blockchain-service/data/ (same pattern as obelisk-service); __dirname at runtime is dist/
const STATE_FILE_PATH =
  process.env.STATE_FILE_PATH ||
  path.join(path.resolve(__dirname, ".."), "data", "clanker_state.json");
const CLANKER_HOOK_ADDRESS =
  process.env.CLANKER_HOOK_ADDRESS || "0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC";
const PERSIST_INTERVAL_SEC = Number(process.env.PERSIST_INTERVAL_SEC) || 30;
const BLOCK_POLL_MS_ENV = Number(process.env.BLOCK_POLL_MS) || BLOCK_POLL_MS;
const API_PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8888);
const API_KEY = process.env.BLOCKCHAIN_SERVICE_API_KEY ?? process.env.API_KEY ?? "";

const state = new StateManager(STATE_FILE_PATH);
const stateFileLog = path.join(path.basename(path.dirname(STATE_FILE_PATH)), path.basename(STATE_FILE_PATH));
console.log(`[Clanker] State file: ${stateFileLog}`);
state.load();
state.startPersistInterval(PERSIST_INTERVAL_SEC * 1000);

const cleanupIntervalId = setInterval(() => {
  state.cleanupDeadTokens(CLEANUP_MIN_VOLUME_ETH);
}, CLEANUP_INTERVAL_MS);

const processor = new BlockProcessor(RPC_URL, state, CLANKER_HOOK_ADDRESS);

const CORS_ORIGINS = (process.env.BLOCKCHAIN_CORS_ORIGINS ?? "https://trade.deepentryai.com")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

function verifyApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!API_KEY) {
    next();
    return;
  }
  const authHeader = req.headers.authorization ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const xApiKey = (req.headers["x-api-key"] as string) ?? "";
  if (bearer === API_KEY || xApiKey === API_KEY) {
    next();
    return;
  }
  res.status(401).json({ error: "Invalid or missing API key. Use Authorization: Bearer <key> or X-API-Key: <key>." });
}

app.use("/clanker", verifyApiKey);
app.get("/clanker/state", (_req, res) => {
  res.json(state.getState());
});
app.get("/clanker/launches", (_req, res) => {
  res.json(state.getState().recentLaunches);
});
app.get("/clanker/token/:address", (req, res) => {
  const token = state.getToken(req.params.address);
  if (!token) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  res.json(token);
});

const server = app.listen(API_PORT, () => {
  console.log(`[Clanker] API listening on port ${API_PORT} (auth: ${API_KEY ? "required" : "disabled"})`);
});

function shutdown(): void {
  console.log("[Clanker] Shutting down...");
  server.close();
  clearInterval(cleanupIntervalId);
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
