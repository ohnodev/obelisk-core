/**
 * Test fetching BTC/USD price from Chainlink on Polygon (on-chain).
 * Same source Polymarket uses; could be a clean secondary fallback.
 * Run: npx tsx scripts/test-chainlink-price.ts
 */
import 'dotenv/config';
import { ethers } from 'ethers';

// Chainlink BTC/USD price feed on Polygon mainnet
// https://data.chain.link/feeds/polygon/mainnet/btc-usd
const CHAINLINK_BTC_USD_POLYGON = '0xc907E116054Ad103354f2D350FD2514433D57F6f';

const AGGREGATOR_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];

async function main() {
  const rpc = process.env.POLYGON_RPC_URL || 'https://polygon-mainnet.g.alchemy.com/v2/demo';
  console.log('=== Chainlink BTC/USD on Polygon (on-chain) test ===\n');
  console.log('RPC:', rpc.replace(/\/[^/]+$/, '/...'));
  console.log('Feed:', CHAINLINK_BTC_USD_POLYGON);

  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const feed = new ethers.Contract(CHAINLINK_BTC_USD_POLYGON, AGGREGATOR_ABI, provider);

  try {
    const [roundId, answer, startedAt, updatedAt] = await feed.latestRoundData();
    const decimals = await feed.decimals();
    const priceRaw = answer.toString();
    const priceUsd = Number(priceRaw) / 10 ** Number(decimals);

    const now = Math.floor(Date.now() / 1000);
    const ageSec = now - Number(updatedAt);

    console.log('\n--- Result ---');
    console.log('Round ID:', roundId.toString());
    console.log('Answer (raw):', priceRaw);
    console.log('Decimals:', decimals);
    console.log('BTC/USD:', priceUsd.toFixed(2));
    console.log('Updated at (unixtime):', updatedAt.toString(), `(${ageSec}s ago)`);
    console.log('\nOK — Chainlink on-chain price fetch works.');
  } catch (err: unknown) {
    console.error('\nFAIL:', (err as Error).message);
    process.exit(1);
  }
}

main();
