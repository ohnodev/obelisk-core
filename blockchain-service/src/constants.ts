/**
 * Contract addresses and event signatures for Base / Clanker V4.
 * Pool Manager emits Initialize; we filter by Clanker hook.
 */
export const POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b".toLowerCase();
export const WETH = "0x4200000000000000000000000000000000000006".toLowerCase();
export const CLANKER_FACTORY = "0xE85A59c628F7d27878ACeB4bf3b35733630083a9".toLowerCase();

/** Uniswap V4 Pool Manager: Initialize(bytes32 id, address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick) */
export const V4_INITIALIZE_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
/** V4 Swap event signature */
export const UNIV4_SWAP_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

export const RECENT_LAUNCHES_MAX = 50;
export const LAST_N_SWAPS = 20;
export const PERSIST_INTERVAL_MS = 30_000;
export const BLOCK_POLL_MS = 1000;
