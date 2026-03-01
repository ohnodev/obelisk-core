import { Router, type Request, type Response } from 'express';
import {
  getCurrent,
  getEvents,
  getCacheStatus,
  getOrderBook,
  getPriceHistory,
  getEventBySlug,
  getBtcPrices,
  getLatestBtcPrice,
  isBtcPriceConnected,
  getCurrentPriceToBeat,
  getPriceToBeatMap,
  getObi,
} from '../services/marketCache.js';
import { getProbabilityForPoint } from '../services/probabilityModel.js';
import { getCurrentZMove, getZMoveProbabilityForPoint } from '../services/zMoveModel.js';
import { WINDOW_SEC, extractWindowTs } from '../utils/windowUtils.js';

const router = Router();

const TOKEN_ID_PATTERN = /^\d{10,}$/;

function isValidTokenId(id: string): boolean {
  return TOKEN_ID_PATTERN.test(id);
}

router.get('/current', (_req: Request, res: Response) => {
  const data = getCurrent();
  if (!data) {
    res.status(404).json({ error: 'No active BTC 5-min market found' });
    return;
  }
  res.json(data);
});

router.get('/orderbook/:tokenId', async (req: Request, res: Response) => {
  if (!isValidTokenId(req.params.tokenId)) {
    res.status(400).json({ error: 'Invalid tokenId' });
    return;
  }
  try {
    const book = await getOrderBook(req.params.tokenId);
    res.json(book);
  } catch (err) {
    console.error('[/api/market/orderbook] Error:', err);
    res.status(500).json({ error: 'Failed to fetch orderbook' });
  }
});

router.get('/history/:tokenId', async (req: Request, res: Response) => {
  if (!isValidTokenId(req.params.tokenId)) {
    res.status(400).json({ error: 'Invalid tokenId' });
    return;
  }
  try {
    const { tokenId } = req.params;
    const interval = (req.query.interval as string) || '1h';
    const fidelity = Number(req.query.fidelity) || 1;
    const validIntervals = ['1h', '6h', '1d', '1w', '1m', 'max'] as const;
    const safeInterval = validIntervals.includes(interval as typeof validIntervals[number])
      ? (interval as typeof validIntervals[number])
      : '1h';
    const history = await getPriceHistory(tokenId, safeInterval, fidelity);
    res.json(history);
  } catch (err) {
    console.error('[/api/market/history] Error:', err);
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

router.get('/events', (req: Request, res: Response) => {
  const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined;
  res.json(getEvents(active));
});

router.get('/event/:slug', async (req: Request, res: Response) => {
  try {
    const event = await getEventBySlug(req.params.slug);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    res.json(event);
  } catch (err) {
    console.error('[/api/market/event] Error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

router.get('/snapshot', (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined;
  const current = getCurrent();
  const latestPrice = getLatestBtcPrice();
  const priceToBeat = getCurrentPriceToBeat();
  let modelPUp: number | null = null;
  let modelPUpZMove: number | null = null;
  let zMoveCurrent: number | null = null;
  let timeRemaining: number | null = null;
  let distancePct: number | null = null;
  if (current && latestPrice !== null && priceToBeat !== null && priceToBeat > 0) {
    const windowTs = extractWindowTs(current.event.slug);
    if (windowTs !== null) {
      const now = Date.now() / 1000;
      timeRemaining = Math.max(0, windowTs + WINDOW_SEC - now);
      distancePct = ((latestPrice - priceToBeat) / priceToBeat) * 100;
      if (timeRemaining > 0) {
        modelPUp = getProbabilityForPoint(distancePct, timeRemaining);
        modelPUpZMove = getZMoveProbabilityForPoint(distancePct, timeRemaining, windowTs);
        zMoveCurrent = getCurrentZMove(distancePct, windowTs);
      }
    }
  }
  res.json({
    current,
    events: getEvents(active),
    btcPrice: {
      prices: getBtcPrices(),
      latestPrice,
      connected: isBtcPriceConnected(),
    },
    priceToBeat,
    priceToBeatMap: getPriceToBeatMap(),
    obi: getObi(),
    modelPUp,
    modelPUpZMove,
    zMoveCurrent,
    timeRemaining,
    distancePct,
  });
});

router.get('/btc-price', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    prices: getBtcPrices(),
    latestPrice: getLatestBtcPrice(),
    connected: isBtcPriceConnected(),
  });
});

router.get('/status', (_req: Request, res: Response) => {
  res.json(getCacheStatus());
});

export default router;
