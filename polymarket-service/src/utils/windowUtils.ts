/** 5-minute window duration in seconds (BTC up/down markets). */
export const WINDOW_SEC = 300;

/**
 * Extract Unix timestamp of the 5-minute window from a BTC up/down event slug.
 * e.g. "btc-updown-5m-1735012800" -> 1735012800
 */
export function extractWindowTs(slug: string): number | null {
  const m = slug.match(/btc-updown-5m-(\d+)$/);
  return m ? Number(m[1]) : null;
}
