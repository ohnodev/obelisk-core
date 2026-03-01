/**
 * Redeem resolved positions using Polymarket Data API + CTF contract.
 * Uses Data API /positions?user=&redeemable=true to fetch only positions we can redeem,
 * then redeems via CTF. Falls back to Gamma (closed btc-updown-5m markets) if Data API
 * returns nothing. Uses TransactionService for gas, timeouts, nonce recovery.
 */

import { ethers } from 'ethers';
import { getPrivateKey } from './clobOrders.js';
import { TransactionService, isGasPriceError, isNoPositionError } from './transactionService.js';

const DATA_API = 'https://data-api.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CTF_EXCHANGE = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const PARENT_COLLECTION_ID = '0x' + '00'.repeat(32);
const WINDOWS_TO_CHECK = 12;
const CTF_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
];

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
}

interface GammaEvent {
  markets: GammaMarket[];
}

/** Fetch redeemable positions from Data API. Returns condition IDs and per-position resolution (asset, outcome, pnl). */
async function fetchRedeemableFromDataApi(
  walletAddress: string,
): Promise<{ conditionIds: string[]; resolvedPositions: ResolvedPosition[] }> {
  const url = `${DATA_API}/positions?user=${encodeURIComponent(walletAddress)}&redeemable=true&limit=100`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { conditionIds: [], resolvedPositions: [] };
    const raw = await res.json();
    if (!Array.isArray(raw)) {
      console.warn('[Redeem] Data API positions response is not an array, skipping');
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
  } catch {
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

/** Fallback: closed btc-updown-5m markets from Gamma (blind scan, many will have no position). */
async function fetchResolvedConditionIdsFromGamma(): Promise<string[]> {
  const ids: string[] = [];
  for (const ts of recentWindowTimestamps()) {
    const slug = `btc-updown-5m-${ts}`;
    const url = `${GAMMA_API}/events?slug=${slug}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const events = (await res.json()) as GammaEvent[];
      for (const event of events) {
        for (const market of event.markets || []) {
          if (!market.closed) continue;
          const cid = market.conditionId ?? market.condition_id;
          if (cid && /^0x[a-fA-F0-9]{64}$/.test(cid)) {
            ids.push(cid);
          }
        }
      }
    } catch {
      // skip failed fetches
    }
  }
  return ids;
}

export async function runHousekeeping(): Promise<{
  redeemed: number;
  noPosition: number;
  errors: number;
  resolvedPositions: ResolvedPosition[];
}> {
  const pk = getPrivateKey();
  if (!pk) {
    throw new Error('Private key not configured — housekeeping disabled');
  }
  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pk, provider);
  const txService = new TransactionService({ provider, signer });

  let { conditionIds, resolvedPositions } = await fetchRedeemableFromDataApi(signer.address);
  if (conditionIds.length > 0) {
    console.log(`[Redeem] Data API: ${conditionIds.length} redeemable position(s) for ${signer.address.slice(0, 10)}…`);
  } else {
    conditionIds = await fetchResolvedConditionIdsFromGamma();
    resolvedPositions = [];
    if (conditionIds.length > 0) {
      console.log(`[Redeem] Gamma fallback: ${conditionIds.length} resolved btc-updown-5m market(s)`);
    }
  }
  let redeemed = 0;
  let noPosition = 0;
  let errors = 0;

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
        timeoutMs: 60_000, // 30s × 2 attempts (replacement with 2x gas); nonce reset on timeout
      });
      redeemed++;
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
  return { redeemed, noPosition, errors, resolvedPositions };
}
