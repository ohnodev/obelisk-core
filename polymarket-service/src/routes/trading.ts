import { Router, type NextFunction, type Request, type Response } from 'express';
import { placeOrder, cancelOrder, getOpenOrders } from '../services/clobOrders.js';
import { runHousekeeping } from '../services/redeemPositions.js';

const router = Router();

function isValidHexPrivateKey(s: string): boolean {
  const t = (s ?? '').trim();
  if (t.length !== 64 && t.length !== 66) return false;
  const hex = t.startsWith('0x') ? t.slice(2) : t;
  return /^[a-fA-F0-9]{64}$/.test(hex);
}

function getBrainUrl(): string | undefined {
  return process.env.BRAIN_URL;
}

function requireTradingAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.POLYMARKET_TRADING_API_KEY;
  const allowUnauth =
    process.env.ALLOW_UNAUTHENTICATED_TRADING === 'true' || process.env.ALLOW_UNAUTHENTICATED_TRADING === '1';
  if (!apiKey && allowUnauth) {
    next(); // explicit opt-in for local/dev when TRADING_API_KEY is unset
    return;
  }
  if (!apiKey) {
    res.status(401).json({ error: 'Trading auth required (POLYMARKET_TRADING_API_KEY or ALLOW_UNAUTHENTICATED_TRADING)' });
    return;
  }
  const key = req.header('x-api-key');
  if (key !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function getProxyTimeoutMs(): number {
  return Number(process.env.TRADING_PROXY_TIMEOUT_MS) || 5000;
}

async function proxyToBrain(method: string, path: string, req: Request, res: Response): Promise<void> {
  const brainUrl = getBrainUrl();
  if (!brainUrl) {
    res.status(503).json({
      error: 'Brain service not configured (BRAIN_URL not set). Run brain manually or set BRAIN_URL.',
    });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getProxyTimeoutMs());
  try {
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const resp = await fetch(`${brainUrl}${path}`, {
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
  if (!isValidHexPrivateKey(pk)) {
    res.status(400).json({ error: 'privateKey must be a 32-byte hex string (64 hex chars or 66 with 0x prefix)' });
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
    const priceNumeric = Number(price);
    const sizeNumeric = Number(size);
    if (!Number.isFinite(priceNumeric) || priceNumeric <= 0 || !Number.isFinite(sizeNumeric) || sizeNumeric <= 0) {
      res.status(400).json({ error: 'Invalid price or size; must be positive finite numbers' });
      return;
    }
    const result = await placeOrder({
      tokenId,
      side: side as 'BUY' | 'SELL',
      price: priceNumeric,
      size: sizeNumeric,
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
  if (!isValidHexPrivateKey(pk)) {
    res.status(400).json({ error: 'privateKey must be a 32-byte hex string (64 hex chars or 66 with 0x prefix)' });
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
  if (!isValidHexPrivateKey(pk)) {
    res.status(400).json({ error: 'privateKey must be a 32-byte hex string (64 hex chars or 66 with 0x prefix)' });
    return;
  }
  try {
    const orders = await getOpenOrders(undefined, pk);
    let cancelled = 0;
    let failed = 0;
    for (const o of orders) {
      try {
        await cancelOrder(o.id, pk);
        cancelled++;
      } catch (err) {
        failed++;
        console.error('[Trading] close-orders: failed to cancel order', o.id, err);
      }
    }
    res.json({ ok: true, cancelled, failed, total: orders.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Trading] close-orders error:', err);
    res.status(500).json({ error: msg });
  }
});

router.post('/redeem', requireTradingAuth, async (req: Request, res: Response) => {
  const { privateKey } = (req.body ?? {}) as { privateKey?: string };
  const pk = privateKey?.trim() || null;
  if (!pk) {
    res.status(400).json({ error: 'privateKey is required in request body' });
    return;
  }
  if (!isValidHexPrivateKey(pk)) {
    res.status(400).json({ error: 'privateKey must be a 32-byte hex string (64 hex chars or 66 with 0x prefix)' });
    return;
  }
  try {
    const result = await runHousekeeping(pk);
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Trading] redeem error:', err);
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
  if (!isValidHexPrivateKey(pk)) {
    res.status(400).json({ error: 'privateKey must be a 32-byte hex string (64 hex chars or 66 with 0x prefix)' });
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
    brain: getBrainUrl() ? 'configured' : 'not_configured',
  });
});

router.get('/trades', (_req: Request, res: Response) => {
  res.json({ trades: [] });
});

router.post('/start', requireTradingAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await proxyToBrain('POST', '/start', req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/stop', requireTradingAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await proxyToBrain('POST', '/stop', req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/sniper/start', requireTradingAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await proxyToBrain('POST', '/start', req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/sniper/stop', requireTradingAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await proxyToBrain('POST', '/stop', req, res);
  } catch (err) {
    next(err);
  }
});

router.get('/sniper/status', async (_req: Request, res: Response, next: NextFunction) => {
  if (!getBrainUrl()) {
    res.json({ running: false, trade_count: 0 });
    return;
  }
  try {
    await proxyToBrain('GET', '/status', _req, res);
  } catch (err) {
    next(err);
  }
});


router.get('/sniper/trades', (_req: Request, res: Response) => {
  res.json({ trades: [] });
});

export default router;
