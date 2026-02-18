/**
 * ETH/USD price service — refreshes every 60s from multiple free APIs,
 * caches the last known price as fallback if all sources fail.
 */

interface PriceResult {
  usd: number;
  updatedAt: number;
  source: string;
  stale: boolean;
}

const REFRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

type PriceFetcher = () => Promise<number>;

const sources: Array<{ name: string; fetch: PriceFetcher }> = [
  {
    name: "coingecko",
    fetch: async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ethereum?: { usd?: number } };
      const price = data?.ethereum?.usd;
      if (!price || price <= 0) throw new Error("invalid price");
      return price;
    },
  },
  {
    name: "coinbase",
    fetch: async () => {
      const res = await fetch(
        "https://api.coinbase.com/v2/prices/ETH-USD/spot",
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { data?: { amount?: string } };
      const price = parseFloat(data?.data?.amount ?? "");
      if (!price || price <= 0) throw new Error("invalid price");
      return price;
    },
  },
  {
    name: "binance",
    fetch: async () => {
      const res = await fetch(
        "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { price?: string };
      const price = parseFloat(data?.price ?? "");
      if (!price || price <= 0) throw new Error("invalid price");
      return price;
    },
  },
];

export class EthPriceService {
  private cached: PriceResult = { usd: 0, updatedAt: 0, source: "none", stale: true };
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /** Start the background refresh loop. Fetches immediately on first call. */
  start(): void {
    this.refresh();
    this.intervalId = setInterval(() => this.refresh(), REFRESH_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getPrice(): PriceResult {
    return { ...this.cached };
  }

  private async refresh(): Promise<void> {
    for (const src of sources) {
      try {
        const usd = await src.fetch();
        this.cached = { usd, updatedAt: Date.now(), source: src.name, stale: false };
        return;
      } catch {
        // try next source
      }
    }
    if (this.cached.usd > 0) {
      this.cached.stale = true;
      console.warn("[EthPrice] All sources failed — serving stale price");
    } else {
      console.error("[EthPrice] All sources failed and no cached price available");
    }
  }
}
