/**
 * Test Gamma API structure for btc-updown-5m — verify we can extract
 * conditionId, clobTokenIds, outcomePrices to build resolvedPositions.
 * Run: npx tsx scripts/test-gamma-resolution.ts
 */
import { parseStringOrArray } from '../src/utils/parseStringOrArray.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';

function recentWindowTimestamps(): number[] {
  const now = Math.floor(Date.now() / 1000);
  const currentWindow = Math.floor(now / 300) * 300;
  const out: number[] = [];
  for (let i = 1; i <= 3; i++) {
    out.push(currentWindow - i * 300);
  }
  return out;
}

async function main() {
  console.log('=== Gamma API btc-updown-5m resolution test ===\n');

  for (const ts of recentWindowTimestamps()) {
    const slug = `btc-updown-5m-${ts}`;
    const url = `${GAMMA_API}/events?slug=${slug}`;
    console.log(`Fetching ${slug}...`);

    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  Status ${res.status}, skip\n`);
      continue;
    }

    const events = (await res.json()) as Record<string, unknown>[];
    for (const event of events) {
      const markets = (event.markets ?? []) as Record<string, unknown>[];
      for (const market of markets) {
        const closed = market.closed === true;
        const cid = (market.conditionId ?? market.condition_id) as string;
        if (!cid || !/^0x[a-fA-F0-9]{64}$/.test(cid)) continue;

        const outcomePrices = parseStringOrArray(market.outcomePrices);
        const clobTokenIds = parseStringOrArray(market.clobTokenIds);
        const winningIdx = outcomePrices.findIndex((p) => {
          const n = Number(parseFloat(String(p).trim()));
          return !Number.isNaN(n) && n === 1;
        });
        const winningTokenId = winningIdx >= 0 && clobTokenIds[winningIdx] ? clobTokenIds[winningIdx] : null;

        console.log(`  conditionId: ${cid}`);
        console.log(`  closed: ${closed}`);
        console.log(`  outcomePrices: ${JSON.stringify(outcomePrices)}`);
        console.log(`  clobTokenIds: [${clobTokenIds.map((id) => id.slice(0, 20) + '…').join(', ')}]`);
        console.log(`  winningIdx: ${winningIdx}, winningTokenId: ${winningTokenId ?? 'N/A'}`);
        if (winningTokenId) {
          console.log(`  => ResolvedPosition: { asset: "${winningTokenId}", outcome: "Won", pnl: null }`);
        }
        console.log('');
      }
    }
  }

  console.log('=== Done ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
