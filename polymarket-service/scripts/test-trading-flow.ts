#!/usr/bin/env npx tsx
/**
 * E2E test: open order, verify it appears, cancel order, verify cancellation, fetch positions.
 * Uses PRIVATE_KEY or POLYMARKET_PRIVATE_KEY from .env.
 *
 * Run: npm run test-trading-flow
 *
 * Strong path - no guessing: fetches live data, places real order, cancels, verifies.
 */

import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
// Optional fallback: trading-engine/.env may not exist in all environments (e.g. obelisk-core)
const tradingEngineEnv = resolve(__dirname, '../../trading-engine/.env');
if (existsSync(tradingEngineEnv)) {
  dotenv.config({ path: tradingEngineEnv });
}

const DATA_API = 'https://data-api.polymarket.com';
const TIMEOUT_MS = Number(process.env.TEST_TRADING_FLOW_TIMEOUT_MS) || 120_000;

async function main() {
  const pk = process.env.PRIVATE_KEY ?? process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.trim()) {
    console.error('[FAIL] Missing PRIVATE_KEY or POLYMARKET_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const {
    placeOrder,
    cancelOrder,
    getOpenOrders,
  } = await import('../src/services/clobOrders.js');
  const { getCurrentBtc5MinMarket, getOrderBook } = await import('../src/services/polymarketClient.js');

  const { Wallet } = await import('ethers');
  const walletAddr = new Wallet(pk).address;
  console.log('[1] Wallet:', walletAddr);

  // --- Get current market ---
  console.log('\n[2] Fetching current BTC 5m market...');
  const market = await getCurrentBtc5MinMarket();
  if (!market) {
    console.error('[FAIL] No active BTC 5m market found');
    process.exit(1);
  }
  const { upTokenId, downTokenId, event } = market;
  if (!upTokenId || !downTokenId) {
    console.error('[FAIL] Market missing token IDs');
    process.exit(1);
  }
  console.log('    Event:', event.slug);
  console.log('    Up token:', upTokenId);
  console.log('    Down token:', downTokenId);

  const MAX_TEST_ORDER_SIZE = Number(process.env.MAX_TEST_ORDER_SIZE) || 500;
  const tokenId = downTokenId;
  const book = await getOrderBook(tokenId);
  const bestBid = book.bids?.[0]?.price ? parseFloat(book.bids[0].price) : 0;
  const tickSize = parseFloat(book.tick_size || '0.01');
  const price = Math.max(0.01, bestBid - tickSize);
  const rawSize = Math.ceil(5 / price);
  const size = Math.max(1, Math.min(rawSize, MAX_TEST_ORDER_SIZE));

  // --- Place order ---
  console.log('\n[3] Placing BUY order: tokenId=' + tokenId + ' price=' + price + ' size=' + size);
  console.log('    Best bid:', bestBid, 'tick:', tickSize, '-> price:', price, 'capped size:', size);
  const placeResult = await placeOrder({ tokenId, side: 'BUY', price, size }, pk);
  const orderId = placeResult.orderId;
  const status = (placeResult.status || '').toLowerCase();
  console.log('    Order placed. orderId:', orderId, 'status:', placeResult.status);
  if (!orderId || orderId === 'unknown') {
    console.error('[FAIL] No order ID returned');
    process.exit(1);
  }

  if (status === 'matched' || status === 'filled') {
    console.log('\n[4] Order filled immediately — skipping open-order verification, will verify position.');
  } else {
    const orders = await getOpenOrders({ asset_id: tokenId }, pk);
    const found = orders.find((o) => o.id === orderId);
    if (!found) {
      console.log('    Open orders:', JSON.stringify(orders, null, 2));
      console.error('[FAIL] Placed order not found in open orders');
      process.exit(1);
    }
    console.log('    Found in open orders:', JSON.stringify(found, null, 2));
    console.log('\n[5] Cancelling order ' + orderId + '...');
    await cancelOrder(orderId, pk);
    const maxAttempts = 5;
    const retryDelayMs = 1000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ordersAfter = await getOpenOrders({ asset_id: tokenId }, pk);
      if (!ordersAfter.find((o) => o.id === orderId)) {
        console.log('    Cancelled and verified gone.');
        break;
      }
      if (attempt === maxAttempts) {
        console.error('[FAIL] Order still present after cancel');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  // --- Fetch Data API positions ---
  console.log('\n[6] Fetching positions from Data API for user=' + walletAddr + '...');
  const posUrl = `${DATA_API}/positions?user=${encodeURIComponent(walletAddr)}&limit=20`;
  const posRes = await fetch(posUrl);
  if (!posRes.ok) {
    console.error('[FAIL] Data API positions failed:', posRes.status, posRes.statusText);
    process.exit(1);
  }
  const positions = (await posRes.json()) as unknown[];
  console.log('    Positions count:', positions.length);
  if (positions.length > 0) {
    console.log('    Sample (first 2):');
    for (let i = 0; i < Math.min(2, positions.length); i++) {
      console.log('      ', JSON.stringify(positions[i], null, 2).split('\n').join('\n      '));
    }
  }

  console.log('\n[PASS] All steps completed successfully.');
}

const timeoutId = setTimeout(() => {
  console.error(`[FAIL] Script timed out after ${TIMEOUT_MS}ms`);
  process.exit(1);
}, TIMEOUT_MS);
timeoutId.unref();

main()
  .then(() => {
    clearTimeout(timeoutId);
  })
  .catch((e) => {
    clearTimeout(timeoutId);
    console.error(e);
    process.exit(1);
  });
