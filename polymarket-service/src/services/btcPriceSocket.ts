import WebSocket from 'ws';
import { ethers } from 'ethers';
import { writeFileSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WS_URL = 'wss://ws-live-data.polymarket.com';
const CHAINLINK_BTC_USD_POLYGON = '0xc907E116054Ad103354f2D350FD2514433D57F6f';
const BINANCE_BACKUP_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';

const CHAINLINK_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];
const PING_INTERVAL_MS = 5_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 5_000;
const RECONNECT_429_MIN_MS = 30_000;
const RECONNECT_429_MAX_MS = 60_000;
const STALE_FEED_MS = 10_000;
const HEALTH_CHECK_MS = 2_000;
const BACKUP_POLL_MS = 15_000;
const MAX_POINTS = 600;
const SAVE_INTERVAL_MS = 30_000;
const MAX_AGE_SEC = 600;
const BTC_SYMBOL = 'btc/usd';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DATA_FILE = join(DATA_DIR, 'btc-prices.json');

export interface BtcPricePoint {
  time: number;
  value: number;
}

let ws: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setInterval> | null = null;
let backupTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let reconnectAttempts = 0;
let lastErrorWas429 = false;

const points: BtcPricePoint[] = [];
let latestPrice: number | null = null;
let socketOpenAtMs = 0;
let lastMessageAtMs = 0;
let lastBtcAtMs = 0;
let lastBackupAtMs = 0;

function loadFromDisk(): void {
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw) as { points?: BtcPricePoint[] };
    if (!Array.isArray(data.points)) return;

    const cutoff = Date.now() / 1000 - MAX_AGE_SEC;
    const restored = data.points.filter(
      (p) => typeof p.time === 'number' && typeof p.value === 'number' && p.time > cutoff,
    );
    if (restored.length === 0) return;

    points.length = 0;
    points.push(...restored.slice(-MAX_POINTS));
    latestPrice = points.length > 0 ? points[points.length - 1].value : null;
    console.log(`[BtcPriceSocket] Loaded ${points.length} points from disk`);
  } catch {
    // file doesn't exist or is corrupt -- start fresh
  }
}

function saveToDisk(): void {
  if (points.length === 0) return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), points }));
    renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('[BtcPriceSocket] Failed to save prices:', (err as Error).message);
  }
}

function cleanup() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }
}

function nowMs(): number {
  return Date.now();
}

function normalizeTimestampToSec(ts: number): number {
  // Some feeds emit ms, others seconds. Normalize both.
  return ts > 1_000_000_000_000 ? ts / 1000 : ts;
}

/** Try Chainlink on-chain (second fallback — same source as Polymarket). */
async function fetchChainlinkPrice(): Promise<number | null> {
  const rpc = process.env.POLYGON_RPC_URL;
  if (!rpc) return null;
  try {
    const provider = new ethers.providers.JsonRpcProvider(rpc);
    const feed = new ethers.Contract(CHAINLINK_BTC_USD_POLYGON, CHAINLINK_ABI, provider);
    const [, answer, , updatedAt] = await feed.latestRoundData();
    const decimals = await feed.decimals();
    const priceUsd = Number(answer.toString()) / 10 ** Number(decimals);
    const ageSec = Math.floor(Date.now() / 1000) - Number(updatedAt);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0 || ageSec > 300) return null;
    return priceUsd;
  } catch {
    return null;
  }
}

/** Try Binance (third fallback). */
async function fetchBinancePrice(): Promise<number | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(BINANCE_BACKUP_URL, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as { price?: string };
    const val = json.price ? parseFloat(json.price) : NaN;
    return Number.isFinite(val) && val > 0 ? val : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function fetchBackupPrice(): Promise<void> {
  if (!running) return;
  let val: number | null = null;
  val = await fetchChainlinkPrice();
  if (val == null) val = await fetchBinancePrice();
  if (val == null) return;
  const point: BtcPricePoint = { time: Math.floor(Date.now() / 1000), value: val };
  if (appendPoint(point)) {
    latestPrice = val;
    lastBackupAtMs = nowMs();
  }
}

function appendPoint(point: BtcPricePoint): boolean {
  const last = points.length > 0 ? points[points.length - 1] : null;
  if (last && point.time < last.time) {
    return false; // drop out-of-order points
  }
  if (last && point.time === last.time) {
    // replace same-timestamp point to keep freshest value
    last.value = point.value;
  } else {
    points.push(point);
    if (points.length > MAX_POINTS) {
      points.splice(0, points.length - MAX_POINTS);
    }
  }
  return true;
}

function connect() {
  if (!running) return;
  cleanup();

  const sock = new WebSocket(WS_URL);
  ws = sock;

  sock.on('open', () => {
    reconnectAttempts = 0;
    lastErrorWas429 = false;
    lastBackupAtMs = 0;
    const now = nowMs();
    socketOpenAtMs = now;
    lastMessageAtMs = now;
    console.log('[BtcPriceSocket] Connected');

    sock.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [{
        topic: 'crypto_prices_chainlink',
        type: '*',
        filters: '',
      }],
    }));

    pingTimer = setInterval(() => {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send('PING');
      }
    }, PING_INTERVAL_MS);

    healthTimer = setInterval(() => {
      if (!running || sock.readyState !== WebSocket.OPEN) return;
      const now = nowMs();
      const staleAny = now - lastMessageAtMs > STALE_FEED_MS;
      const staleBtc = lastBtcAtMs > 0 && now - lastBtcAtMs > STALE_FEED_MS;
      const staleSinceOpen =
        lastBtcAtMs === 0 && socketOpenAtMs > 0 && now - socketOpenAtMs > STALE_FEED_MS;
      if (staleAny || staleBtc || staleSinceOpen) {
        console.warn(
          `[BtcPriceSocket] Stale feed detected (any=${now - lastMessageAtMs}ms, btc=${lastBtcAtMs > 0 ? now - lastBtcAtMs : -1}ms, open=${socketOpenAtMs > 0 ? now - socketOpenAtMs : -1}ms) — reconnecting`,
        );
        sock.terminate();
      }
    }, HEALTH_CHECK_MS);
  });

  sock.on('message', (raw: WebSocket.RawData) => {
    lastMessageAtMs = nowMs();
    const data = raw.toString();
    if (data === 'PONG') return;

    try {
      const msg = JSON.parse(data);
      if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.symbol === BTC_SYMBOL) {
        const ts = msg.payload.timestamp;
        const val = msg.payload.value;
        if (typeof ts !== 'number' || typeof val !== 'number' || !Number.isFinite(ts) || !Number.isFinite(val) || ts <= 0 || val <= 0) {
          console.warn('[BtcPriceSocket] Dropping invalid BTC tick', { ts, val });
          return;
        }
        const point: BtcPricePoint = { time: normalizeTimestampToSec(ts), value: val };
        if (appendPoint(point)) {
          latestPrice = val;
          lastBtcAtMs = nowMs();
        }
      }
    } catch {
      // ignore non-JSON
    }
  });

  sock.on('close', () => {
    maybeStartBackupPoll();
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
    if (running) {
      let baseDelay: number;
      if (lastErrorWas429) {
        baseDelay = RECONNECT_429_MIN_MS + Math.floor(Math.random() * (RECONNECT_429_MAX_MS - RECONNECT_429_MIN_MS));
        console.log(`[BtcPriceSocket] Rate limited (429), backing off ${(baseDelay / 1000).toFixed(0)}s before retry`);
      } else {
        baseDelay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
        baseDelay += Math.floor(Math.random() * 500);
        console.log(`[BtcPriceSocket] Disconnected, reconnecting in ${(baseDelay / 1000).toFixed(1)}s...`);
      }
      reconnectAttempts++;
      reconnectTimer = setTimeout(connect, baseDelay);
    }
  });

  sock.on('error', (err: Error) => {
    lastErrorWas429 = /429/.test(err.message);
    console.error('[BtcPriceSocket] Error:', err.message);
    sock.close();
  });
}

function maybeStartBackupPoll(): void {
  if (backupTimer) return;
  const healthy = (lastBtcAtMs > 0 && nowMs() - lastBtcAtMs <= STALE_FEED_MS) ||
    (lastBackupAtMs > 0 && nowMs() - lastBackupAtMs <= STALE_FEED_MS);
  if (healthy) return;
  backupTimer = setInterval(() => {
    if (!running) return;
    const now = nowMs();
    const primaryFresh = lastBtcAtMs > 0 && now - lastBtcAtMs <= STALE_FEED_MS;
    const backupFresh = lastBackupAtMs > 0 && now - lastBackupAtMs <= STALE_FEED_MS;
    if (primaryFresh) {
      if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
      return;
    }
    if (!backupFresh) void fetchBackupPrice();
  }, BACKUP_POLL_MS);
  console.log('[BtcPriceSocket] Backup poll (Chainlink → Binance) started — primary feed unavailable');
  void fetchBackupPrice();
}

export function startBtcPriceSocket(): void {
  if (running) return;
  running = true;
  reconnectAttempts = 0;
  loadFromDisk();
  console.log('[BtcPriceSocket] Starting');
  connect();
  saveTimer = setInterval(saveToDisk, SAVE_INTERVAL_MS);
  setTimeout(maybeStartBackupPoll, 5_000);
}

export function stopBtcPriceSocket(): void {
  running = false;
  reconnectAttempts = 0;
  if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
  saveToDisk();
  cleanup();
  socketOpenAtMs = 0;
  lastMessageAtMs = 0;
  lastBtcAtMs = 0;
  lastBackupAtMs = 0;
  latestPrice = null;
  console.log('[BtcPriceSocket] Stopped');
}

export function getBtcPrices(): BtcPricePoint[] {
  return points.slice();
}

export function getLatestBtcPrice(): number | null {
  return latestPrice;
}

export function isBtcPriceConnected(): boolean {
  const now = nowMs();
  if (lastBtcAtMs > 0 && now - lastBtcAtMs <= STALE_FEED_MS) return true;
  if (lastBackupAtMs > 0 && now - lastBackupAtMs <= STALE_FEED_MS) return true;
  return false;
}

export function clearBtcPrices(): void {
  points.length = 0;
  latestPrice = null;
}
