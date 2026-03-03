/**
 * CLOB order placement service for polymarket-service.
 * Uses @polymarket/clob-client to create and post orders.
 *
 * Auth fix: createOrDeriveApiKey() fails with 400 "Could not create api key" when an API key
 * already exists (tries create first). Use deriveApiKey() first; only create if derive returns no key.
 * See: https://github.com/Polymarket/clob-client/issues/202
 */

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import { getOrderBook } from './polymarketClient.js';

function getClobUrl(): string {
  return process.env.CLOB_URL || 'https://clob.polymarket.com';
}
const CHAIN_ID = 137; // Polygon

const VALID_TICK_SIZES = ['0.1', '0.01', '0.001', '0.0001'] as const;
type TickSize = (typeof VALID_TICK_SIZES)[number];

function parseTickSize(raw: unknown): TickSize {
  const s = String(raw ?? '').trim();
  if (VALID_TICK_SIZES.includes(s as TickSize)) return s as TickSize;
  return '0.01';
}

const MAX_CACHED_CLIENTS = 100;
const clientCache = new Map<string, ClobClient>();
/** Serialize credential fetch per pk to avoid concurrent create/derive races. */
const credFetchLocks = new Map<string, Promise<ClobClient>>();

async function getApiCredentials(pk: string): Promise<{ apiKey: string; secret: string; passphrase: string }> {
  const clobUrl = getClobUrl();
  const signer = new ethers.Wallet(pk);
  const tempClient = new ClobClient(clobUrl, CHAIN_ID, signer);

  // Try derive first — works when key exists. createOrDerive tries create first and fails with 400.
  let creds: { apiKey?: string; key?: string; secret?: string; passphrase?: string } | null = null;
  try {
    creds = await tempClient.deriveApiKey();
  } catch {
    // derive can fail when no key exists; fall through to create
  }
  const hasKey = creds && (creds.apiKey || creds.key);
  if (!hasKey) {
    try {
      creds = await tempClient.createApiKey();
    } catch (e) {
      throw new Error(
        `Could not derive or create CLOB API credentials: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const apiKey = creds?.apiKey ?? creds?.key;
  if (!apiKey || !creds?.secret || !creds?.passphrase) {
    throw new Error('Could not derive or create CLOB API credentials (missing key, secret, or passphrase)');
  }
  return { apiKey, secret: creds.secret, passphrase: creds.passphrase };
}

async function getClient(pk: string): Promise<ClobClient> {
  const key = pk.trim();
  if (!key || key.length < 20) {
    throw new Error('privateKey is required in request body');
  }
  const cached = clientCache.get(key);
  if (cached) return cached;

  if (clientCache.size >= MAX_CACHED_CLIENTS) {
    const firstKey = clientCache.keys().next().value;
    if (firstKey) clientCache.delete(firstKey);
  }

  // Serialize credential fetch per pk to avoid concurrent create/derive races
  let pending = credFetchLocks.get(key);
  if (!pending) {
    pending = (async () => {
      const clobUrl = getClobUrl();
      const signer = new ethers.Wallet(key);
      const apiCreds = await getApiCredentials(key);
      const c = new ClobClient(clobUrl, CHAIN_ID, signer, apiCreds, 0 as 0 | 1, signer.address);
      clientCache.set(key, c);
      credFetchLocks.delete(key);
      return c;
    })();
    credFetchLocks.set(key, pending);
  }
  return pending;
}

export interface PlaceOrderParams {
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  orderType?: 'GTC' | 'FOK' | 'FAK';
}

export interface PlaceOrderResult {
  orderId: string;
  status: string;
}

export async function placeOrder(params: PlaceOrderParams, pk: string): Promise<PlaceOrderResult> {
  const { tokenId, side, price, size } = params;

  const book = await getOrderBook(tokenId);
  const tickSize = parseTickSize(book.tick_size);
  const negRisk = book.neg_risk ?? true;

  const c = await getClient(pk);
  // createAndPostOrder accepts GTC | GTD only (FOK/FAK are for market orders via createAndPostMarketOrder)
  const ot = (params.orderType ?? 'GTC').toUpperCase();
  const orderTypeEnum = ot === 'GTD' ? OrderType.GTD : OrderType.GTC;
  const sideEnum = side === 'SELL' ? Side.SELL : Side.BUY;

  const response = await c.createAndPostOrder(
    {
      tokenID: tokenId,
      price,
      size,
      side: sideEnum,
    },
    {
      tickSize,
      negRisk,
    },
    orderTypeEnum,
  );

  const r = response as { orderID?: unknown; order_id?: unknown; status?: string };
  const raw = r?.orderID ?? r?.order_id ?? response;
  let orderId: string;
  if (typeof raw === 'string') {
    orderId = raw;
  } else if (raw != null && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    orderId = typeof o.orderID === 'string' ? o.orderID : typeof o.order_id === 'string' ? o.order_id : '';
  } else {
    orderId = raw != null ? String(raw) : '';
  }
  if (!orderId || orderId.trim() === '') {
    throw new Error(
      `Place order response missing orderId: ${JSON.stringify(response)}`,
    );
  }
  return {
    orderId,
    status: r.status ?? 'placed',
  };
}

export async function cancelOrder(orderId: string, pk: string): Promise<void> {
  const c = await getClient(pk);
  await c.cancelOrder({ orderID: orderId });
}

export interface OpenOrderInfo {
  id: string;
  asset_id: string;
  side: string;
  original_size: string;
  size_matched: string;
  price: string;
}

/** Fetch open orders (optionally filtered by asset_id). Returns array of orders. */
export async function getOpenOrders(params?: { asset_id?: string }, pk?: string): Promise<OpenOrderInfo[]> {
  if (!pk?.trim()) throw new Error('privateKey is required in request body');
  const c = await getClient(pk);
  const res = (await c.getOpenOrders(params, true)) as { data?: OpenOrderInfo[] };
  return res?.data ?? [];
}
