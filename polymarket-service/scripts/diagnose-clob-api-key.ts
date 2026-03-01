#!/usr/bin/env npx tsx
/**
 * Diagnostic script for Polymarket CLOB "Could not create api key" (400) errors.
 * Tests: sequential create/derive, concurrent calls, nonce behavior.
 *
 * Run: npm run diagnose-clob-api-key
 * Requires: PRIVATE_KEY or POLYMARKET_PRIVATE_KEY in .env
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../../trading-engine/.env') });

const CLOB_URL = process.env.CLOB_URL || 'https://clob.polymarket.com';
const CHAIN_ID = 137;

async function createOrDeriveOnce(label: string): Promise<{ ok: boolean; err?: string }> {
  const pk = process.env.PRIVATE_KEY ?? process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.trim()) return { ok: false, err: 'No key' };
  const signer = new ethers.Wallet(pk);
  const temp = new ClobClient(CLOB_URL, CHAIN_ID, signer);
  try {
    await temp.createOrDeriveApiKey();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, err: msg };
  }
}

async function main() {
  const pk = process.env.PRIVATE_KEY ?? process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.trim()) {
    console.error('[FAIL] Missing PRIVATE_KEY or POLYMARKET_PRIVATE_KEY');
    process.exit(1);
  }
  const addr = new ethers.Wallet(pk).address;
  console.log('[Diagnose] Wallet:', addr);
  console.log('[Diagnose] CLOB:', CLOB_URL);
  console.log('');

  // 1. Sequential: 3 createOrDerive calls (fresh client each time, no cache)
  console.log('--- 1. Sequential createOrDerive (3x, no cache) ---');
  for (let i = 1; i <= 3; i++) {
    const before = Date.now();
    const r = await createOrDeriveOnce(`seq-${i}`);
    const ms = Date.now() - before;
    console.log(`  ${i}. ${r.ok ? 'OK' : 'FAIL'} (${ms}ms) ${r.err ? `: ${r.err.slice(0, 80)}` : ''}`);
  }
  console.log('');

  // 2. Concurrent: 3 simultaneous createOrDerive (simulates race)
  console.log('--- 2. Concurrent createOrDerive (3 at once) ---');
  const concurrent = await Promise.allSettled([
    createOrDeriveOnce('conc-1'),
    createOrDeriveOnce('conc-2'),
    createOrDeriveOnce('conc-3'),
  ]);
  concurrent.forEach((p, i) => {
    const r = p.status === 'fulfilled' ? p.value : { ok: false, err: String(p.reason) };
    console.log(`  ${i + 1}. ${r.ok ? 'OK' : 'FAIL'} ${r.err ? `: ${r.err.slice(0, 80)}` : ''}`);
  });
  const concFails = concurrent.filter(
    (p) => p.status === 'fulfilled' && !(p.value as { ok: boolean }).ok,
  ).length;
  if (concFails > 0) {
    console.log(`  => ${concFails} failed — possible nonce race or rate limit`);
  }
  console.log('');

  // 3. Rapid-fire: 5 calls with 200ms gap (rate limit test)
  console.log('--- 3. Rapid sequential (5x with 200ms gap) ---');
  for (let i = 1; i <= 5; i++) {
    if (i > 1) await new Promise((x) => setTimeout(x, 200));
    const r = await createOrDeriveOnce(`rapid-${i}`);
    console.log(`  ${i}. ${r.ok ? 'OK' : 'FAIL'} ${r.err ? r.err.slice(0, 60) : ''}`);
  }
  console.log('');
  console.log('[Done] If concurrent or rapid fails: consider serialize getClient() or add retry with backoff.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
