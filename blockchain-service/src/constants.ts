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

/** Clanker factory: TokenCreated(..., bytes32 poolId, ...) — same tx as Initialize */
export const TOKEN_CREATED_TOPIC =
  "0x9299d1d1a88d8e1abdc591ae7a167a6bc63a8f17d695804e9091ee33aa89fb67";

/** GodMulticall (from base-swap-tracker): batch V4 pool + token resolution in one RPC */
export const GOD_MULTICALL_ADDRESS =
  typeof process !== "undefined" && process.env?.GOD_MULTICALL_ADDRESS
    ? process.env.GOD_MULTICALL_ADDRESS
    : "0xEAae97dd1220C19C49cadc04C0f7aC5866fcEA3d";

/** ABI for batchGetCompleteV4PoolInfo — returns pool + token0/token1 details (name, symbol, decimals, totalSupply) in one call */
export const GOD_MULTICALL_V4_ABI = [
  "function batchGetCompleteV4PoolInfo(bytes32[] calldata poolKeys) external view returns (tuple(bytes32 poolKey, address token0, address token1, uint24 fee, int24 tickSpacing, address hooks, tuple(address tokenAddress, string name, string symbol, uint8 decimals, uint256 totalSupply, bool success, bool isKnownToken) token0Details, tuple(address tokenAddress, string name, string symbol, uint8 decimals, uint256 totalSupply, bool success, bool isKnownToken) token1Details, bool success, string errorMessage)[] results)",
] as const;

export const RECENT_LAUNCHES_MAX = 50;
export const LAST_N_SWAPS = 20;
export const PERSIST_INTERVAL_MS = 30_000;
export const BLOCK_POLL_MS = 1000;
