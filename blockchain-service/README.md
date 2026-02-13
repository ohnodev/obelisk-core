# Clanker Blockchain Service

Listens to Base for Uniswap V4 Pool Manager `Initialize` events with the Clanker hook, tracks those pools, and aggregates swap stats (volume in ETH, price in ETH, last 20 swaps). State is kept in memory and persisted to JSON so Obelisk workflows can read it.

**Two outputs (two loops):**

1. **State file** (`clanker_state.json`) – Token/pool stats and recent launches. The workflow’s “analysis” loop (scheduler → launch summary → inference → buy) reads this.
2. **OnSwap trigger file** (`last_swap.json`) – On every swap the service overwrites this file with the latest swap payload (poolId, tokenAddress, side, volumeEth, priceEth, timestamp). The workflow’s “sell” loop (scheduler → On Swap Trigger → Bag Checker → Clanker Sell) uses it to react to new swaps and hit profit/stop-loss.

## Env

Copy `env.example` to `.env` and set:

- **RPC_URL** – Base RPC (default: `https://mainnet.base.org`)
- **STATE_FILE_PATH** – Where to write/read `clanker_state.json` (default: `data/clanker_state.json` inside this folder)
- **ON_SWAP_FILE** – Where to write last swap on each swap for workflow trigger (default: `data/last_swap.json`)
- **CLANKER_HOOK_ADDRESS** – Only pool inits with this hook are tracked (default: `0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC`)
- **PERSIST_INTERVAL_SEC** – How often to write state to disk (default: 30)
- **BLOCK_POLL_MS** – Block polling interval (default: 1000)

## Run

```bash
npm install
npm run build
npm start
```

**Files (same dir as state):**

- `clanker_state.json` – Token/pool stats; Obelisk nodes read this (or set STATE_FILE_PATH in both).
- `last_swap.json` – Last swap payload for the On Swap Trigger node (same path as ON_SWAP_FILE).
- `clanker_bags.json` – Written by the workflow (Add To Bags node), not by this service; holds our positions and profit/stop-loss targets.
