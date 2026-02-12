# Clanker Blockchain Service

Listens to Base for Uniswap V4 Pool Manager `Initialize` events with the Clanker hook, tracks those pools, and aggregates swap stats (total swaps, buys, sells, optional 24h volume and last 20 swaps). State is kept in memory and persisted to a single JSON file so Obelisk workflows can read it.

## Env

Copy `env.example` to `.env` and set:

- **RPC_URL** – Base RPC (default: `https://mainnet.base.org`)
- **STATE_FILE_PATH** – Where to write/read `clanker_state.json` (default: `data/clanker_state.json` inside this folder)
- **CLANKER_HOOK_ADDRESS** – Only pool inits with this hook are tracked (default: `0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC`)
- **PERSIST_INTERVAL_SEC** – How often to write state to disk (default: 30)
- **BLOCK_POLL_MS** – Block polling interval (default: 1000)

## Run

```bash
npm install
npm run build
npm start
```

State file: by default `blockchain-service/data/clanker_state.json`. Obelisk nodes read from the same path (or set STATE_FILE_PATH in both so they match).
