import { Router, type NextFunction, type Request, type Response } from 'express';
import { placeOrder, cancelOrder, getOpenOrders } from '../services/clobOrders.js';
import { runHousekeeping } from '../services/redeemPositions.js';

const router = Router();

const BRAIN_URL = process.env.BRAIN_URL;
const TRADING_API_KEY = process.env.POLYMARKET_TRADING_API_KEY;

function requireTradingAuth(req: Request, res: Response, next: NextFunction): void {
  if (!TRADING_API_KEY) {
    next(); // optional: when not configured, allow (local dev)
    return;
  }
  const key = req.header('x-api-key');
  if (key !== TRADING_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
const PROXY_TIMEOUT_MS = Number(process.env.TRADING_PROXY_TIMEOUT_MS) || 5000;

async function proxyToBrain(method: string, path: string, req: Request, res: Response): Promise<void> {
  if (!BRAIN_URL) {
    res.status(503).json({
      error: 'Brain service not configured (BRAIN_URL not set). Run brain manually or set BRAIN_URL.',
    });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const resp = await fetch(`${BRAIN_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: hasBody ? { 'content-type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    });
    clearTimeout(timer);
    const text = await resp.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      res.status(resp.status).send(text);
      return;
    }
    res.status(resp.status).json(body);
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const status = isTimeout ? 504 : 502;
    const label = isTimeout ? 'Gateway Timeout' : 'Brain unreachable';
    res.status(status).json({ error: `${label}` });
  }
}

router.post('/order', requireTradingAuth, async (req: Request, res: Response) => {
  const { privateKey, tokenId, side, price, size, orderType } = (req.body ?? {}) as {
    privateKey?: string;
    tokenId?: string;
    side?: string;
    price?: number;
    size?: number;
    orderType?: string;
  };
  const pk = privateKey?.trim() || null;
  if (!pk) {
    res.status(400).json({ error: 'privateKey is required in request body' });
    return;
  }
  try {
    if (!tokenId || !side || price == null || size == null) {
      res.status(400).json({ error: 'Missing required fields: tokenId, side, price, size' });
      return;
    }
    if (side !== 'BUY' && side !== 'SELL') {
      res.status(400).json({ error: 'side must be BUY or SELL' });
      return;
    }
    const result = await placeOrder({
      tokenId,
      side: side as 'BUY' | 'SELL',
      price: Number(price),
      size: Number(size),
      orderType: orderType as 'GTC' | 'FOK' | 'FAK' | undefined,
    }, pk);
    res.json(result);
  } catch (err) {
    const axiosData = (err as { response?: { data?: { error?: string }; status?: number } }).response?.data;
    const apiError = typeof axiosData?.error === 'string' ? axiosData.error : null;
    const msg = apiError ?? (err instanceof Error ? err.message : 'Unknown error');
    const lower = msg.toLowerCase();
    const isClientError =
      lower.includes('balance') || lower.includes('allowance') || lower.includes('insufficient');
    const status = isClientError ? 400 : 500;
    console.error('[Trading] place order error:', err);
    res.status(status).json({ error: msg });
  }
});

router.post('/order/cancel', requireTradingAuth, async (req: Request, res: Response) => {
  const { privateKey, orderId } = (req.body ?? {}) as { privateKey?: string; orderId?: string };
  const pk = privateKey?.trim() || null;
  if (!pk) {
    res.status(400).json({ error: 'privateKey is required in request body' });
    return;
  }
  try {
    if (!orderId) {
      res.status(400).json({ error: 'Missing orderId' });
      return;
    }
    await cancelOrder(orderId, pk);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Trading] cancel order error:', err);
    res.status(500).json({ error: msg });
  }
});

router.post('/close-orders', requireTradingAuth, async (req: Request, res: Response) => {
  const { privateKey } = (req.body ?? {}) as { privateKey?: string };
  const pk = privateKey?.trim() || null;
  if (!pk) {
    res.status(400).json({ error: 'privateKey is required in request body' });
    return;
  }
  try {
    const orders = await getOpenOrders(undefined, pk);
    let cancelled = 0;
    for (const o of orders) {
      try {
        await cancelOrder(o.id, pk);
        cancelled++;
      } catch {
        // skip failed cancels
      }
    }
    res.json({ ok: true, cancelled, total: orders.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Trading] close-orders error:', err);
    res.status(500).json({ error: msg });
  }
});

router.post('/housekeeping', requireTradingAuth, async (req: Request, res: Response) => {
  const { privateKey } = (req.body ?? {}) as { privateKey?: string };
  const pk = privateKey?.trim() || null;
  if (!pk) {
    res.status(400).json({ error: 'privateKey is required in request body' });
    return;
  }
  try {
    const result = await runHousekeeping(pk);
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Trading] housekeeping error:', err);
    res.status(500).json({ error: msg });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    service: 'polymarket-service',
    running: true,
    clob: 'requires_private_key_in_body',
    brain: BRAIN_URL ? 'configured' : 'not_configured',
  });
});

router.get('/trades', (_req: Request, res: Response) => {
  res.json({ trades: [] });
});

router.post('/start', requireTradingAuth, (req: Request, res: Response) => {
  proxyToBrain('POST', '/start', req, res);
});

router.post('/stop', requireTradingAuth, (req: Request, res: Response) => {
  proxyToBrain('POST', '/stop', req, res);
});

router.post('/sniper/start', requireTradingAuth, (req: Request, res: Response) => {
  proxyToBrain('POST', '/start', req, res);
});

router.post('/sniper/stop', requireTradingAuth, (req: Request, res: Response) => {
  proxyToBrain('POST', '/stop', req, res);
});

router.get('/sniper/status', (_req: Request, res: Response) => {
  if (!BRAIN_URL) {
    res.json({ running: false, trade_count: 0 });
    return;
  }
  proxyToBrain('GET', '/status', _req, res);
});


router.get('/sniper/trades', (_req: Request, res: Response) => {
  res.json({ trades: [] });
});

export default router;
