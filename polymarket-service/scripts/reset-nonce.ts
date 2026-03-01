#!/usr/bin/env npx tsx
/**
 * Reset stuck nonce by replacing the pending tx with a 0-value self-transfer.
 * Run: npm run reset-nonce  (from polymarket-service/)
 *
 * Loads PRIVATE_KEY or POLYMARKET_PRIVATE_KEY from .env (or trading-engine/.env).
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../../trading-engine/.env') });

const GAS_STATION = 'https://gasstation.polygon.technology/v2';

async function main() {
  const pk = process.env.PRIVATE_KEY ?? process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.trim()) {
    console.error('Set PRIVATE_KEY or POLYMARKET_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const rpc = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);

  const pendingNonce = await provider.getTransactionCount(wallet.address, 'pending');
  const latestNonce = await provider.getTransactionCount(wallet.address, 'latest');

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Nonce: latest=${latestNonce} pending=${pendingNonce}`);

  if (pendingNonce <= latestNonce) {
    console.log('No stuck nonce — pending equals latest. Nothing to do.');
    return;
  }

  const stuckCount = pendingNonce - latestNonce;
  console.log(`${stuckCount} stuck tx(s) at nonces ${latestNonce}..${pendingNonce - 1}. Replacing all.\n`);

  // Fetch high gas to replace stuck txs
  let tip = ethers.utils.parseUnits('120', 'gwei');
  let maxFee = ethers.utils.parseUnits('300', 'gwei');
  try {
    const res = await fetch(GAS_STATION);
    if (res.ok) {
      const data = (await res.json()) as { fast?: { maxPriorityFee: number; maxFee: number } };
      if (data.fast) {
        tip = ethers.utils.parseUnits(String(Math.ceil(data.fast.maxPriorityFee * 1.5)), 'gwei');
        maxFee = ethers.utils.parseUnits(String(Math.ceil(data.fast.maxFee * 1.5)), 'gwei');
      }
    }
  } catch {
    // use defaults
  }

  for (let n = latestNonce; n < pendingNonce; n++) {
    try {
      const tx = await wallet.sendTransaction({
        to: wallet.address,
        value: ethers.BigNumber.from(0),
        nonce: n,
        gasLimit: 21000,
        maxPriorityFeePerGas: tip,
        maxFeePerGas: maxFee,
      });
      console.log(`Nonce ${n}: tx ${tx.hash}`);
      await tx.wait();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('nonce too low') || msg.includes('NONCE_EXPIRED')) {
        console.log(`Nonce ${n}: already used (cleared)`);
      } else {
        throw e;
      }
    }
  }
  console.log('\nDone. Stuck nonces cleared.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
