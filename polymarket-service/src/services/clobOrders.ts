/**
 * CLOB order placement service for polymarket-service.
 * Uses @polymarket/clob-client to create and post orders.
 */

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import { getOrderBook } from './polymarketClient.js';

const CLOB_URL = process.env.CLOB_URL || 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon

let privateKeyOverride: string | null = null;
let client: ClobClient | null = null;

export function setPrivateKey(pk: string | null): void {
  privateKeyOverride = pk?.trim() || null;
  client = null; // invalidate cache when key changes
}

export function getPrivateKey(): string | null {
  return (
    privateKeyOverride ??
    process.env.PRIVATE_KEY ??
    process.env.POLYMARKET_PRIVATE_KEY ??
    null
  );
}

async function getClient(): Promise<ClobClient> {
  const pk = getPrivateKey();
  if (!pk) {
    throw new Error('PRIVATE_KEY env is required for order placement');
  }
  if (client) return client;

  const signer = new ethers.Wallet(pk);
  const tempClient = new ClobClient(CLOB_URL, CHAIN_ID, signer);
  const apiCreds = await tempClient.createOrDeriveApiKey();
  // signatureType 0 = EOA/browser wallet, funder = signer address
  client = new ClobClient(CLOB_URL, CHAIN_ID, signer, apiCreds, 0 as 0 | 1, signer.address);
  return client;
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

export async function placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
  const { tokenId, side, price, size } = params;

  const book = await getOrderBook(tokenId);
  const tickSize = (book.tick_size || '0.01') as '0.1' | '0.01' | '0.001' | '0.0001';
  const negRisk = book.neg_risk ?? true;

  const c = await getClient();
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

export async function cancelOrder(orderId: string): Promise<void> {
  const c = await getClient();
  await c.cancelOrder({ orderID: orderId });
}

export function isClobConfigured(): boolean {
  return !!getPrivateKey();
}

/** Returns the wallet address for the configured private key. */
export function getWalletAddress(): string | null {
  const pk = getPrivateKey();
  if (!pk) return null;
  try {
    return new ethers.Wallet(pk).address;
  } catch {
    return null;
  }
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
export async function getOpenOrders(params?: { asset_id?: string }): Promise<OpenOrderInfo[]> {
  const c = await getClient();
  const res = (await c.getOpenOrders(params, true)) as { data?: OpenOrderInfo[] };
  return res?.data ?? [];
}
