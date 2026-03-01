#!/usr/bin/env npx tsx
/**
 * Trace why trades show Unknown: cross-reference brain trades vs Data API positions.
 * Run: npm run trace-trade-resolution
 * Optional: npm run trace-trade-resolution -- 0xORDERID 0xORDERID2
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../../trading-engine/.env') });

const DATA_API = 'https://data-api.polymarket.com';
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:1113';

async function main() {
  const pk = process.env.PRIVATE_KEY ?? process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.trim()) {
    console.error('[FAIL] Missing PRIVATE_KEY or POLYMARKET_PRIVATE_KEY');
    process.exit(1);
  }
  const { ethers } = await import('ethers');
  const wallet = new ethers.Wallet(pk);
  const addr = wallet.address;
  console.log('[Trace] Wallet:', addr);
  console.log('');

  // 1. Fetch brain trades
  let brainTrades: Array<{ id: number; buy_order_id: string; tokenId?: string; outcome: string; side: string; size: number }> = [];
  try {
    const tr = await fetch(`${BRAIN_URL}/trades`);
    if (tr.ok) {
      const j = (await tr.json()) as { trades?: typeof brainTrades };
      brainTrades = j.trades ?? [];
      console.log(`[Trace] Brain trades: ${brainTrades.length}`);
    } else {
      console.warn('[Trace] Brain /trades failed:', tr.status, '(is brain running?)');
    }
  } catch (e) {
    console.warn('[Trace] Brain unreachable:', e);
  }
  console.log('');

  // 2. Fetch Data API positions (all + redeemable)
  const [allRes, redeemRes] = await Promise.all([
    fetch(`${DATA_API}/positions?user=${encodeURIComponent(addr)}&limit=50`),
    fetch(`${DATA_API}/positions?user=${encodeURIComponent(addr)}&redeemable=true&limit=50`),
  ]);
  const allPositions = allRes.ok ? ((await allRes.json()) as unknown[]) : [];
  const redeemPositions = redeemRes.ok ? ((await redeemRes.json()) as unknown[]) : [];
  console.log(`[Trace] Data API: ${allPositions.length} total positions, ${redeemPositions.length} redeemable`);
  console.log('');

  // 3. Build asset -> position map
  const posByAsset = new Map<string, { redeemable: boolean; curPrice: number; outcome: string; size: number }>();
  for (const p of allPositions as Array<{ asset?: string; token?: string; redeemable?: boolean; currPrice?: number; curPrice?: number; outcome?: string; size?: number }>) {
    const asset = p.token ?? p.asset;
    if (!asset) continue;
    const curPrice = p.currPrice ?? p.curPrice ?? 0;
    const redeemable = !!p.redeemable;
    const outcome = !redeemable ? 'Open' : curPrice >= 0.5 ? 'Won' : 'Lost';
    posByAsset.set(asset, { redeemable, curPrice, outcome, size: p.size ?? 0 });
  }
  for (const p of redeemPositions as Array<{ asset?: string; token?: string; currPrice?: number; curPrice?: number; size?: number }>) {
    const asset = p.token ?? p.asset;
    if (!asset) continue;
    const curPrice = p.currPrice ?? p.curPrice ?? 0;
    posByAsset.set(asset, {
      redeemable: true,
      curPrice,
      outcome: curPrice >= 0.5 ? 'Won' : 'Lost',
      size: p.size ?? 0,
    });
  }

  // 4. Cross-reference
  const unknown = brainTrades.filter((t) => t.outcome === 'Unknown');
  console.log(`[Trace] Trades with Unknown: ${unknown.length}`);
  if (unknown.length > 0) {
    for (const t of unknown) {
      const tokenId = t.tokenId ?? '(no tokenId)';
      const pos = tokenId !== '(no tokenId)' ? posByAsset.get(tokenId) : undefined;
      console.log(`  #${t.id} order=${t.buy_order_id?.slice(0, 18)}... tokenId=${String(tokenId).slice(0, 20)}... side=${t.side} size=${t.size}`);
      if (!t.tokenId) {
        console.log(`    => No tokenId stored (old trade before fix)`);
      } else if (pos) {
        console.log(`    => Position: redeemable=${pos.redeemable} curPrice=${pos.curPrice} => ${pos.outcome}`);
      } else {
        console.log(`    => No matching Data API position (market may still be open or position closed/redeemed)`);
      }
    }
  }
  console.log('');

  // 5. If order IDs passed, look up in CLOB
  const orderIds = process.argv.slice(2).filter((a) => a.startsWith('0x'));
  if (orderIds.length > 0) {
    const { ClobClient } = await import('@polymarket/clob-client');
    const signer = new ethers.Wallet(pk);
    const temp = new ClobClient('https://clob.polymarket.com', 137, signer);
    const creds = await temp.createOrDeriveApiKey();
    const client = new ClobClient('https://clob.polymarket.com', 137, signer, creds, 0 as 0 | 1, signer.address);
    console.log('[Trace] Looking up order IDs in CLOB:');
    for (const oid of orderIds) {
      try {
        const o = await client.getOrder(oid);
        const oa = o as { asset_id?: string; side?: string; status?: string; original_size?: string };
        console.log(`  ${oid.slice(0, 18)}... => asset_id=${oa.asset_id ?? '?'} status=${oa.status ?? '?'}`);
        if (oa.asset_id) {
          const pos = posByAsset.get(oa.asset_id);
          if (pos) console.log(`    Data API: redeemable=${pos.redeemable} outcome=${pos.outcome}`);
        }
      } catch (e) {
        console.log(`  ${oid.slice(0, 18)}... => error: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
