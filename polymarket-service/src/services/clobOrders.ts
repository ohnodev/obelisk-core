/**
 * CLOB order placement service for polymarket-service.
 * Uses @polymarket/clob-client to create and post orders.
 */

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import { getOrderBook } from './polymarketClient.js';

const CLOB_URL = process.env.CLOB_URL || 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon

const clientCache = new Map<string, ClobClient>();

async function getClient(pk: string): Promise<ClobClient> {
  const key = pk.trim();
  if (!key || key.length < 20) {
    throw new Error('privateKey is required in request body');
  }
  const cached = clientCache.get(key);
  if (cached) return cached;

  const signer = new ethers.Wallet(key);
  const tempClient = new ClobClient(CLOB_URL, CHAIN_ID, signer);
  const apiCreds = await tempClient.createOrDeriveApiKey();
  const c = new ClobClient(CLOB_URL, CHAIN_ID, signer, apiCreds, 0 as 0 | 1, signer.address);
  clientCache.set(key, c);
  return c;
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
  const tickSize = (book.tick_size || '0.01') as '0.1' | '0.01' | '0.001' | '0.0001';
  const negRisk = book.neg_risk ?? true;

  const c = await getClient(pk);
  const orderTypeEnum = OrderType.GTC;
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

  const r = response as { orderID?: unknown; order_id?: unknown };
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
  return {
    orderId: orderId || 'unknown',
    status: (response as { status?: string }).status ?? 'placed',
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
