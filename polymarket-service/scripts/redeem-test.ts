#!/usr/bin/env npx tsx
/**
 * Redeem test script — attempts to redeem resolved positions using the key from .env.
 * Run from polymarket-service root:
 *   npx tsx scripts/redeem-test.ts
 *
 * Requires in .env: PRIVATE_KEY or POLYMARKET_PRIVATE_KEY, POLYGON_RPC_URL
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../../trading-engine/.env') }); // fallback for POLYMARKET_PRIVATE_KEY

async function main() {
  const pk = process.env.PRIVATE_KEY ?? process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.trim()) {
    console.error('Missing PRIVATE_KEY or POLYMARKET_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
  console.log('Redeem test — using key from .env, RPC:', rpcUrl.split('/').slice(0, -1).join('/') + '/...');

  const { runHousekeeping } = await import('../src/services/redeemPositions.js');
  const result = await runHousekeeping();
  console.log('Done:', result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
