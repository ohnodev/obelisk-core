import {
  getCurrentBtc5MinMarket,
  searchBtc5MinEvents,
  getOrderBook,
  getPriceHistory,
  getEventBySlug,
  type EnrichedMarketData,
  type GammaEvent,
  type OrderBook,
} from './polymarketClient.js';
import {
  startBtcPriceSocket,
  stopBtcPriceSocket,
  getBtcPrices,
  getLatestBtcPrice,
  isBtcPriceConnected,
} from './btcPriceSocket.js';
import { recordObservation } from './marketObservations.js';
import { extractWindowTs } from '../utils/windowUtils.js';

const MARKET_REFRESH_MS = 500;
const EVENTS_REFRESH_MS = 5_000;

interface CacheState {
  current: EnrichedMarketData | null;
  events: GammaEvent[];
  lastCurrentUpdate: number;
  lastEventsUpdate: number;
  refreshCount: number;
  errors: { current: string | null; events: string | null };
}

const state: CacheState = {
  current: null,
  events: [],
  lastCurrentUpdate: 0,
  lastEventsUpdate: 0,
  refreshCount: 0,
  errors: { current: null, events: null },
};

const priceToBeatMap = new Map<number, number>();

function updatePriceToBeat(): void {
  const prices = getBtcPrices();
  if (prices.length === 0) return;

  const windowTimestamps: number[] = [];

  if (state.current) {
    const ts = extractWindowTs(state.current.event.slug);
    if (ts) windowTimestamps.push(ts);
  }
  for (const ev of state.events) {
    const ts = extractWindowTs(ev.slug);
    if (ts) windowTimestamps.push(ts);
  }

  for (const windowTs of windowTimestamps) {
    if (priceToBeatMap.has(windowTs)) continue;

    let closest: { time: number; value: number } | null = null;
    let closestDiff = Infinity;
    for (const p of prices) {
      const diff = Math.abs(p.time - windowTs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = p;
      }
    }
    if (closest && closestDiff < 60) {
      priceToBeatMap.set(windowTs, closest.value);
      console.log(`[MarketCache] Price to beat for window ${windowTs}: $${closest.value.toFixed(2)}`);
    }
  }
}

const OBI_LEVELS = 10;
const LOW_LIQUIDITY_THRESHOLD = 500;

export interface ObiData {
  value: number;
  upDepth: number;
  downDepth: number;
  lowLiquidity: boolean;
}

let currentObi: ObiData | null = null;

function sumTopBidDepth(book: OrderBook | null, n: number): number {
  if (!book || book.bids.length === 0) return 0;
  const count = Math.min(n, book.bids.length);
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += parseFloat(book.bids[i].price) * parseFloat(book.bids[i].size);
  }
  return total;
}

function computeOBI(upBook: OrderBook | null, downBook: OrderBook | null): ObiData {
  const upDepth = sumTopBidDepth(upBook, OBI_LEVELS);
  const downDepth = sumTopBidDepth(downBook, OBI_LEVELS);
  const denom = upDepth + downDepth;
  return {
    value: denom > 0 ? (upDepth - downDepth) / denom : 0,
    upDepth,
    downDepth,
    lowLiquidity: denom < LOW_LIQUIDITY_THRESHOLD,
  };
}

let marketTimer: ReturnType<typeof setInterval> | null = null;
let eventsTimer: ReturnType<typeof setInterval> | null = null;
let refreshingCurrent = false;
let refreshingEvents = false;

async function refreshCurrent(): Promise<void> {
  if (refreshingCurrent) return;
  refreshingCurrent = true;
  try {
    const data = await getCurrentBtc5MinMarket();
    if (data) {
      state.current = data;
      state.errors.current = null;
      state.lastCurrentUpdate = Date.now();
      state.refreshCount++;
      updatePriceToBeat();
      currentObi = computeOBI(data.orderbook.up, data.orderbook.down);

      const mktUp = data.midpoints.up ? Number(data.midpoints.up) : data.outcomePrices[0] ?? null;
      const ptb = getCurrentPriceToBeat();
      recordObservation(data.event.slug, getLatestBtcPrice(), ptb, mktUp);
    }
  } catch (err) {
    state.errors.current = err instanceof Error ? err.message : 'Unknown error';
    currentObi = null;
    console.error('[MarketCache] current refresh failed:', state.errors.current);
  } finally {
    refreshingCurrent = false;
  }
}

async function refreshEvents(): Promise<void> {
  if (refreshingEvents) return;
  refreshingEvents = true;
  try {
    const events = await searchBtc5MinEvents(undefined, 10);
    state.events = events;
    state.errors.events = null;
    state.lastEventsUpdate = Date.now();
  } catch (err) {
    state.errors.events = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MarketCache] events refresh failed:', state.errors.events);
  } finally {
    refreshingEvents = false;
  }
}

export async function startCache(): Promise<void> {
  if (marketTimer || eventsTimer) {
    console.log('[MarketCache] Already running, skipping duplicate start');
    return;
  }

  console.log(`[MarketCache] Starting — market every ${MARKET_REFRESH_MS}ms, events every ${EVENTS_REFRESH_MS}ms`);

  await Promise.all([refreshCurrent(), refreshEvents()]);
  console.log('[MarketCache] Initial data loaded');

  startBtcPriceSocket();

  marketTimer = setInterval(refreshCurrent, MARKET_REFRESH_MS);
  eventsTimer = setInterval(refreshEvents, EVENTS_REFRESH_MS);
}

export function stopCache(): void {
  if (marketTimer) clearInterval(marketTimer);
  if (eventsTimer) clearInterval(eventsTimer);
  marketTimer = null;
  eventsTimer = null;
  stopBtcPriceSocket();
  console.log('[MarketCache] Stopped');
}

export function getCurrent(): EnrichedMarketData | null {
  return state.current;
}

export function getEvents(active?: boolean): GammaEvent[] {
  if (active === undefined) return state.events;
  return state.events.filter(e => active ? !e.closed : e.closed);
}

export function getCacheStatus() {
  return {
    lastCurrentUpdate: state.lastCurrentUpdate,
    lastEventsUpdate: state.lastEventsUpdate,
    refreshCount: state.refreshCount,
    hasCurrent: state.current !== null,
    eventsCount: state.events.length,
    errors: state.errors,
  };
}

export function getCurrentPriceToBeat(): number | null {
  if (!state.current) return null;
  const ts = extractWindowTs(state.current.event.slug);
  return ts ? priceToBeatMap.get(ts) ?? null : null;
}

export function getPriceToBeatMap(): Record<number, number> {
  return Object.fromEntries(priceToBeatMap);
}

export function getObi(): ObiData | null {
  return currentObi;
}

export { getOrderBook, getPriceHistory, getEventBySlug };
export { getBtcPrices, getLatestBtcPrice, isBtcPriceConnected };
