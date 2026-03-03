#!/usr/bin/env npx tsx
/**
 * Test CLOB auth: derive/create API key and fetch open orders.
 * Uses POLYMARKET_PRIVATE_KEY or PRIVATE_KEY from polymarket-service/.env
 * and trading-engine/.env (if present).
 *
 * Run: npm run test-clob-auth
 */

import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
const tradingEngineEnv = resolve(__dirname, '../../trading-engine/.env');
if (existsSync(tradingEngineEnv)) {
  dotenv.config({ path: tradingEngineEnv });
}

async function main() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!pk?.trim()) {
    console.error('[FAIL] Missing POLYMARKET_PRIVATE_KEY or PRIVATE_KEY');
    process.exit(1);
  }

  const { getOpenOrders } = await import('../src/services/clobOrders.js');
  const { Wallet } = await import('ethers');
  const addr = new Wallet(pk).address;
  console.log('[test-clob-auth] Wallet:', addr);

  const orders = await getOpenOrders(undefined, pk);
  console.log('[test-clob-auth] CLOB auth OK — open orders:', orders.length);
}

main().catch((e) => {
  console.error('[FAIL]', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
