const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate: string;
  startDate: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  active: boolean;
  closed: boolean;
  clobTokenIds: string;
  spread: number;
  lastTradePrice: number;
  bestAsk: number;
  volumeNum: number;
  liquidityNum: number;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  closedTime?: string;
  acceptingOrders: boolean;
}

export interface GammaEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  volume: number;
  markets: GammaMarket[];
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  timestamp: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
  hash: string;
}

export interface PricePoint {
  t: number;
  p: number;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polymarket API error: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Polymarket API error: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json() as Promise<T>;
}

export async function getEventBySlug(slug: string): Promise<GammaEvent | null> {
  const events = await fetchJSON<GammaEvent[]>(`${GAMMA_API}/events?slug=${encodeURIComponent(slug)}`);
  return events[0] ?? null;
}

function getBtc5MinSlug(windowStartTs?: number): string {
  const ts = windowStartTs ?? Math.floor(Date.now() / 1000);
  const aligned = Math.floor(ts / 300) * 300;
  return `btc-updown-5m-${aligned}`;
}

export async function getActiveBtc5MinEvent(): Promise<GammaEvent | null> {
  const slug = getBtc5MinSlug();
  return getEventBySlug(slug);
}

export async function getRecentBtc5MinEvents(count = 10): Promise<GammaEvent[]> {
  const nowTs = Math.floor(Date.now() / 1000);
  const currentWindow = Math.floor(nowTs / 300) * 300;

  const slugs: string[] = [];
  for (let i = 0; i < count; i++) {
    slugs.push(`btc-updown-5m-${currentWindow - i * 300}`);
  }

  const results = await Promise.allSettled(
    slugs.map(slug => getEventBySlug(slug)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<GammaEvent | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((e): e is GammaEvent => e !== null);
}

export async function searchBtc5MinEvents(active?: boolean, count = 10): Promise<GammaEvent[]> {
  const events = await getRecentBtc5MinEvents(count);
  if (active === undefined) return events;
  return events.filter(e => active ? (!e.closed) : e.closed);
}

export async function getOrderBook(tokenId: string): Promise<OrderBook> {
  return fetchJSON<OrderBook>(`${CLOB_API}/book?token_id=${tokenId}`);
}

export async function getMidpoint(tokenId: string): Promise<{ mid: string }> {
  return fetchJSON<{ mid: string }>(`${CLOB_API}/midpoint?token_id=${tokenId}`);
}

export async function getPrice(tokenId: string, side: 'BUY' | 'SELL'): Promise<{ price: string }> {
  return fetchJSON<{ price: string }>(`${CLOB_API}/price?token_id=${tokenId}&side=${side}`);
}

export async function getSpread(tokenId: string): Promise<{ spread: string }> {
  return postJSON<{ spread: string }>(`${CLOB_API}/spreads`, [{ token_id: tokenId }]);
}

export async function getLastTradePrice(tokenId: string): Promise<{ price: string; side: string }> {
  return fetchJSON<{ price: string; side: string }>(`${CLOB_API}/last-trade-price?token_id=${tokenId}`);
}

export async function getPriceHistory(
  tokenId: string,
  interval: '1h' | '6h' | '1d' | '1w' | '1m' | 'max' = '1h',
  fidelity = 1,
): Promise<{ history: PricePoint[] }> {
  return fetchJSON<{ history: PricePoint[] }>(
    `${CLOB_API}/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}`,
  );
}

function parseTokenIds(clobTokenIdsStr: string): string[] {
  try {
    return JSON.parse(clobTokenIdsStr) as string[];
  } catch {
    return [];
  }
}

function parseOutcomes(outcomesStr: string): string[] {
  try {
    return JSON.parse(outcomesStr) as string[];
  } catch {
    return [];
  }
}

function parseOutcomePrices(pricesStr: string): number[] {
  try {
    return (JSON.parse(pricesStr) as string[]).map(Number);
  } catch {
    return [];
  }
}

export interface EnrichedMarketData {
  event: GammaEvent;
  market: GammaMarket;
  outcomes: string[];
  outcomePrices: number[];
  tokenIds: string[];
  upTokenId: string;
  downTokenId: string;
  orderbook: {
    up: OrderBook | null;
    down: OrderBook | null;
  };
  midpoints: {
    up: string | null;
    down: string | null;
  };
}

export async function getCurrentBtc5MinMarket(): Promise<EnrichedMarketData | null> {
  let event = await getActiveBtc5MinEvent();

  if (!event) {
    const recent = await getRecentBtc5MinEvents(3);
    if (recent.length > 0) event = recent[0];
  }

  if (!event || event.markets.length === 0) return null;

  const market = event.markets[0];
  const outcomes = parseOutcomes(market.outcomes);
  const outcomePrices = parseOutcomePrices(market.outcomePrices);
  const tokenIds = parseTokenIds(market.clobTokenIds);

  const upIdx = outcomes.indexOf('Up');
  const downIdx = outcomes.indexOf('Down');
  const upTokenId = tokenIds[upIdx] ?? '';
  const downTokenId = tokenIds[downIdx] ?? '';

  let upBook: OrderBook | null = null;
  let downBook: OrderBook | null = null;
  let upMid: string | null = null;
  let downMid: string | null = null;

  if (market.acceptingOrders || !market.closed) {
    try {
      const [ub, db, um, dm] = await Promise.all([
        upTokenId ? getOrderBook(upTokenId).catch(() => null) : null,
        downTokenId ? getOrderBook(downTokenId).catch(() => null) : null,
        upTokenId ? getMidpoint(upTokenId).catch(() => null) : null,
        downTokenId ? getMidpoint(downTokenId).catch(() => null) : null,
      ]);
      upBook = ub;
      downBook = db;
      upMid = um?.mid ?? null;
      downMid = dm?.mid ?? null;
    } catch {
      // CLOB data unavailable for closed markets
    }
  }

  return {
    event,
    market,
    outcomes,
    outcomePrices,
    tokenIds,
    upTokenId,
    downTokenId,
    orderbook: { up: upBook, down: downBook },
    midpoints: { up: upMid, down: downMid },
  };
}
