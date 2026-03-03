/**
 * Redeem resolved positions using Polymarket Data API + CTF contract.
 * Uses Data API /positions?user=&redeemable=true to fetch only positions we can redeem,
 * then redeems via CTF. Falls back to Gamma (closed btc-updown-5m markets) if Data API
 * returns nothing. Uses TransactionService for gas, timeouts, nonce recovery.
 *
 * Deduplication: condition IDs we successfully redeemed are persisted per user (up to 1k)
 * and skipped on future runs to avoid redundant txs. Survives restarts via JSON file.
 */

import { readFileSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { parseStringOrArray } from '../utils/parseStringOrArray.js';
import { TransactionService, isGasPriceError, isNoPositionError } from './transactionService.js';

const DATA_API = 'https://data-api.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const MAX_REDEEMED_PER_USER = 1000;
const PERSIST_INTERVAL_MS = 60 * 1000; // once per minute

const REDEEMED_FILE = join(process.cwd(), 'data', 'redeemed-conditions.json');

/** userAddress (lowercase) -> conditionId -> redeemedAt */
const redeemedByUser = new Map<string, Map<string, number>>();
let persistTimer: ReturnType<typeof setInterval> | null = null;
const CTF_EXCHANGE = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const PARENT_COLLECTION_ID = '0x' + '00'.repeat(32);
const WINDOWS_TO_CHECK = 12;
const CTF_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
];

function loadRedeemedFromDisk(): void {
  try {
    const raw = readFileSync(REDEEMED_FILE, 'utf-8');
    const data = JSON.parse(raw) as Record<string, Array<{ conditionId: string; redeemedAt: number }>>;
    redeemedByUser.clear();
    for (const [addr, entries] of Object.entries(data)) {
      if (!addr || !Array.isArray(entries)) continue;
      const m = new Map<string, number>();
      for (const e of entries) {
        if (e?.conditionId && typeof e.redeemedAt === 'number') {
          m.set(e.conditionId.toLowerCase(), e.redeemedAt);
        }
      }
      if (m.size > 0) redeemedByUser.set(addr.toLowerCase(), m);
    }
    console.log(`[Redeem] Loaded ${Array.from(redeemedByUser.values()).reduce((s, m) => s + m.size, 0)} redeemed condition(s) for ${redeemedByUser.size} user(s)`);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      const dir = join(process.cwd(), 'data');
      mkdirSync(dir, { recursive: true });
      try {
        const tmpPath = REDEEMED_FILE + '.tmp';
        writeFileSync(tmpPath, '{}', 'utf-8');
        let fd: number | undefined;
        try {
          fd = openSync(tmpPath, 'r');
          fsyncSync(fd);
        } finally {
          if (fd !== undefined) closeSync(fd);
        }
        renameSync(tmpPath, REDEEMED_FILE);
      } catch (writeErr) {
        console.warn('[Redeem] Failed to create redeemed-conditions.json:', writeErr instanceof Error ? writeErr.message : String(writeErr));
      }
    } else {
      console.warn('[Redeem] Failed to load redeemed-conditions.json:', e instanceof Error ? e.message : String(e));
    }
  }
}

function saveRedeemedToDisk(): void {
  try {
    const dir = join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    const data: Record<string, Array<{ conditionId: string; redeemedAt: number }>> = {};
    for (const [addr, m] of redeemedByUser) {
      const entries = Array.from(m.entries())
        .map(([conditionId, redeemedAt]) => ({ conditionId, redeemedAt }))
        .sort((a, b) => b.redeemedAt - a.redeemedAt)
        .slice(0, MAX_REDEEMED_PER_USER);
      if (entries.length > 0) data[addr] = entries;
    }
    const json = JSON.stringify(data, null, 2);
    const tmpPath = REDEEMED_FILE + '.tmp';
    writeFileSync(tmpPath, json, 'utf-8');
    let fd: number | undefined;
    try {
      fd = openSync(tmpPath, 'r');
      fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    renameSync(tmpPath, REDEEMED_FILE);
  } catch (e) {
    console.warn('[Redeem] Failed to persist redeemed-conditions.json:', e instanceof Error ? e.message : String(e));
  }
}

function ensurePersistTimer(): void {
  if (persistTimer) return;
  persistTimer = setInterval(saveRedeemedToDisk, PERSIST_INTERVAL_MS);
  persistTimer.unref?.();
}

function addRedeemed(userAddress: string, conditionId: string): void {
  const addr = userAddress.toLowerCase();
  let m = redeemedByUser.get(addr);
  if (!m) {
    m = new Map();
    redeemedByUser.set(addr, m);
  }
  m.set(conditionId.toLowerCase(), Date.now());
  if (m.size > MAX_REDEEMED_PER_USER) {
    const sorted = Array.from(m.entries()).sort((a, b) => a[1] - b[1]);
    const toDel = sorted.slice(0, m.size - MAX_REDEEMED_PER_USER);
    for (const [cid] of toDel) m.delete(cid);
  }
  ensurePersistTimer();
}

function filterByRedeemed(userAddress: string, conditionIds: string[]): string[] {
  const m = redeemedByUser.get(userAddress.toLowerCase());
  const seen = new Set<string>();
  const result: string[] = [];
  for (const cid of conditionIds) {
    const low = cid.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    if (m?.has(low)) continue;
    result.push(low);
  }
  return result;
}

// Load on module init
loadRedeemedFromDisk();

interface DataApiPosition {
  conditionId?: string;
  condition_id?: string;
  redeemable?: boolean;
  asset?: string;
  token?: string;
  outcome?: string;
  size?: number;
  avgPrice?: number;
  currPrice?: number;
  curPrice?: number;
  realizedPnl?: number;
  cashPnl?: number;
}

export interface ResolvedPosition {
  asset: string;
  outcome: 'Won' | 'Lost' | 'Unresolved';
  pnl: number | null;
}

interface GammaMarket {
  conditionId?: string;
  condition_id?: string;
  closed?: boolean;
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
}

interface GammaEvent {
  markets: GammaMarket[];
}

/** Parsed market info for Gamma fallback — winning token ID for resolved positions. */
interface GammaMarketResolution {
  conditionId: string;
  winningTokenId: string;
}

/** Fetch redeemable positions from Data API. Returns condition IDs and per-position resolution (asset, outcome, pnl). */
async function fetchRedeemableFromDataApi(
  walletAddress: string,
): Promise<{ conditionIds: string[]; resolvedPositions: ResolvedPosition[] }> {
  const url = `${DATA_API}/positions?user=${encodeURIComponent(walletAddress)}&redeemable=true&limit=100`;
  const FETCH_TIMEOUT_MS = 5000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.warn('[Redeem] Data API fetch failed', { url, status: res.status, statusText: res.statusText });
      return { conditionIds: [], resolvedPositions: [] };
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) {
      console.warn('[Redeem] Data API positions response is not an array, skipping', { url, rawType: typeof raw });
      return { conditionIds: [], resolvedPositions: [] };
    }
    const positions = raw as DataApiPosition[];
    const conditionIds: string[] = [];
    const resolvedPositions: ResolvedPosition[] = [];
    for (const p of positions) {
      const cid = p.conditionId ?? p.condition_id;
      if (cid && /^0x[a-fA-F0-9]{64}$/.test(cid)) {
        conditionIds.push(cid);
      }
      const trimmedToken = typeof p.token === 'string' ? p.token.trim() : '';
      const trimmedAsset = typeof p.asset === 'string' ? p.asset.trim() : '';
      const asset = trimmedToken.length > 0 ? trimmedToken : trimmedAsset;
      if (asset.length > 0) {
        const rawFallbackPnl = p.realizedPnl ?? p.cashPnl ?? null;
        const sanitizedFallbackPnl =
          typeof rawFallbackPnl === 'number' && Number.isFinite(rawFallbackPnl)
            ? rawFallbackPnl
            : null;

        const rawCurPrice = p.currPrice ?? p.curPrice;
        const curPriceVal = rawCurPrice == null ? null : Number(rawCurPrice);
        if (curPriceVal == null || !Number.isFinite(curPriceVal)) {
          resolvedPositions.push({ asset, outcome: 'Unresolved', pnl: sanitizedFallbackPnl });
        } else {
          if (p.size == null || p.avgPrice == null) {
            resolvedPositions.push({ asset, outcome: 'Unresolved', pnl: sanitizedFallbackPnl });
          } else {
            const sizeNum = Number(p.size);
            const avgPriceNum = Number(p.avgPrice);
            if (!Number.isFinite(sizeNum) || !Number.isFinite(avgPriceNum)) {
              resolvedPositions.push({ asset, outcome: 'Unresolved', pnl: sanitizedFallbackPnl });
            } else {
              const outcome: 'Won' | 'Lost' = curPriceVal >= 0.5 ? 'Won' : 'Lost';
              const rawPnl =
                (typeof p.realizedPnl === 'number' && Number.isFinite(p.realizedPnl))
                  ? p.realizedPnl
                  : (typeof p.cashPnl === 'number' && Number.isFinite(p.cashPnl))
                    ? p.cashPnl
                    : (outcome === 'Won' ? sizeNum * (1 - avgPriceNum) : -sizeNum * avgPriceNum);
              const pnl = typeof rawPnl === 'number' && Number.isFinite(rawPnl) ? rawPnl : 0;
              resolvedPositions.push({ asset, outcome, pnl });
            }
          }
        }
      }
    }
    return { conditionIds: [...new Set(conditionIds)], resolvedPositions };
  } catch (err) {
    console.warn('[Redeem] Data API fetch error', { url, error: err instanceof Error ? err.message : String(err) });
    return { conditionIds: [], resolvedPositions: [] };
  }
}

function recentWindowTimestamps(): number[] {
  const now = Math.floor(Date.now() / 1000);
  const currentWindow = Math.floor(now / 300) * 300;
  const out: number[] = [];
  for (let i = 1; i <= WINDOWS_TO_CHECK; i++) {
    out.push(currentWindow - i * 300);
  }
  return out;
}

/** Parse outcomePrices and clobTokenIds from Gamma market to get winning token ID. */
function parseWinningTokenId(market: GammaMarket): string | null {
  try {
    const outcomePrices = parseStringOrArray(market.outcomePrices);
    const clobTokenIds = parseStringOrArray(market.clobTokenIds);
    const winningIdx = outcomePrices.findIndex((p) => {
      const n = parseFloat(String(p).trim());
      return !Number.isNaN(n) && n === 1;
    });
    if (winningIdx >= 0 && clobTokenIds[winningIdx]) return clobTokenIds[winningIdx];
  } catch {
    // malformed JSON or missing fields
  }
  return null;
}

/** Fallback: closed btc-updown-5m markets from Gamma with resolution (winning token ID). */
async function fetchResolvedFromGamma(): Promise<{
  conditionIds: string[];
  conditionIdToResolution: Map<string, GammaMarketResolution>;
}> {
  const conditionIds: string[] = [];
  const conditionIdToResolution = new Map<string, GammaMarketResolution>();

  for (const ts of recentWindowTimestamps()) {
    const slug = `btc-updown-5m-${ts}`;
    const url = `${GAMMA_API}/events?slug=${slug}`;
    const GAMMA_FETCH_TIMEOUT_MS = 5000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GAMMA_FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) continue;
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[Redeem] Gamma unexpected response shape (not array)', { url, rawType: typeof raw });
        }
        continue;
      }
      const events = raw as GammaEvent[];
      for (const event of events) {
        const markets = Array.isArray(event?.markets) ? event.markets : [];
        for (const market of markets) {
          if (!market.closed) continue;
          const cid = (market.conditionId ?? market.condition_id) as string;
          if (!cid || !/^0x[a-fA-F0-9]{64}$/.test(cid)) continue;

          const winningTokenId = parseWinningTokenId(market);
          if (winningTokenId) {
            conditionIds.push(cid);
            conditionIdToResolution.set(cid, { conditionId: cid, winningTokenId });
          }
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Redeem] Gamma fetch failed', { url, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { conditionIds: Array.from(new Set(conditionIds)), conditionIdToResolution };
}

export async function runHousekeeping(pk: string): Promise<{
  redeemed: number;
  noPosition: number;
  errors: number;
  resolvedPositions: ResolvedPosition[];
}> {
  const key = pk?.trim();
  if (!key || key.length < 20) {
    throw new Error('privateKey is required in request body');
  }
  // RPC from polymarket-service .env only — workflows never pass RPC URLs
  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(key, provider);
  const txService = new TransactionService({ provider, signer });

  let { conditionIds, resolvedPositions } = await fetchRedeemableFromDataApi(signer.address);
  let conditionIdToResolution = new Map<string, GammaMarketResolution>();

  if (conditionIds.length > 0 && resolvedPositions.length > 0) {
    console.log(`[Redeem] Data API: ${conditionIds.length} redeemable position(s) for ${signer.address.slice(0, 10)}…`);
  } else {
    const gamma = await fetchResolvedFromGamma();
    if (conditionIds.length === 0) {
      conditionIds = gamma.conditionIds;
    }
    conditionIdToResolution = gamma.conditionIdToResolution;
    resolvedPositions = [];
    if (conditionIds.length > 0) {
      console.log(`[Redeem] Gamma fallback: ${conditionIds.length} resolved btc-updown-5m market(s)`);
    }
  }

  // Skip condition IDs we already redeemed (persisted per user; survives restarts)
  const beforeFilter = conditionIds.length;
  conditionIds = filterByRedeemed(signer.address, conditionIds);
  if (beforeFilter > conditionIds.length) {
    console.log(`[Redeem] Skipped ${beforeFilter - conditionIds.length} already-redeemed condition(s) for ${signer.address.slice(0, 10)}…`);
  }

  let redeemed = 0;
  let noPosition = 0;
  let errors = 0;
  const redeemedConditionIds: string[] = [];

  const GAS_LIMIT = 300_000; // bypass estimation; CTF redeem reverts when no position
  const total = conditionIds.length;

  for (let i = 0; i < conditionIds.length; i++) {
    const conditionId = conditionIds[i];
    const n = i + 1;
    try {
      console.log(`[Redeem] Redeem (${n}/${total}) condition=${conditionId.slice(0, 10)}… sending…`);
      const result = await txService.execute({
        contractAddress: CTF_EXCHANGE,
        contractAbi: CTF_ABI,
        method: 'redeemPositions',
        args: [USDC_E, PARENT_COLLECTION_ID, conditionId, [1, 2]],
        gasLimit: ethers.BigNumber.from(GAS_LIMIT),
        timeoutMs: 60_000, // per-attempt timeout; with replacement attempt total max ~120s
      });
      redeemed++;
      redeemedConditionIds.push(conditionId);
      addRedeemed(signer.address, conditionId);
      console.log(
        `[Redeem] REDEEMED condition=${conditionId.slice(0, 10)}…${conditionId.slice(-8)} tx=${result.txHash}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isNoPositionError(msg)) {
        noPosition++;
      } else if (isGasPriceError(msg)) {
        errors++;
        console.error(`[Redeem] gas error condition=${conditionId}:`, msg.slice(0, 200));
      } else {
        errors++;
        const hint = msg.includes('tx timed out') ? ' — tx may confirm later; check polygonscan.com' : '';
        console.error(`[Redeem] error condition=${conditionId}:`, msg + hint);
      }
    }
  }

  if (conditionIds.length > 0) {
    console.log(
      `[Redeem] Checked ${conditionIds.length} resolved markets — redeemed ${redeemed}, no position ${noPosition}, errors ${errors}`,
    );
  }

  // Gamma fallback: build resolvedPositions from redeemed conditionIds so polymarket_trade_outcome_updater can track.
  // Successful redeem implies the user held the winning outcome (losing tokens have no redeemable value), so we set outcome to 'Won'.
  if (resolvedPositions.length === 0 && redeemedConditionIds.length > 0 && conditionIdToResolution.size > 0) {
    for (const cid of redeemedConditionIds) {
      const resolution = conditionIdToResolution.get(cid);
      if (resolution?.winningTokenId) {
        resolvedPositions.push({ asset: resolution.winningTokenId, outcome: 'Won', pnl: null });
      }
    }
  }

  return { redeemed, noPosition, errors, resolvedPositions };
}
