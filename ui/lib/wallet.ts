/**
 * Wallet utilities for authentication and user identification.
 * Uses the connected wallet address as the user identity for agent ownership.
 */

/**
 * Format wallet address for display (truncated)
 */
export function formatAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Normalize wallet address to lowercase for consistent comparison.
 * Agent ownership checks should always compare lowercased addresses.
 */
export function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

/**
 * Check if a wallet address owns an agent (case-insensitive comparison).
 */
export function isAgentOwner(walletAddress: string | undefined, agentUserId: string | undefined | null): boolean {
  if (!walletAddress || !agentUserId) return false;
  return normalizeAddress(walletAddress) === normalizeAddress(agentUserId);
}
