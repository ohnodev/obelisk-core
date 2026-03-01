import { Router, type Request, type Response } from 'express';
import { placeOrder, cancelOrder, isClobConfigured, setPrivateKey } from '../services/clobOrders.js';
import { runHousekeeping } from '../services/redeemPositions.js';

const router = Router();

const BRAIN_URL = process.env.BRAIN_URL;
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

router.post('/order', async (req: Request, res: Response) => {
  if (!isClobConfigured()) {
    res.status(503).json({ error: 'Order placement not configured (PRIVATE_KEY not set)' });
    return;
  }
  try {
    const { tokenId, side, price, size, orderType } = req.body as {
      tokenId?: string;
      side?: string;
      price?: number;
      size?: number;
      orderType?: string;
    };
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
    });
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

router.post('/order/cancel', async (req: Request, res: Response) => {
  if (!isClobConfigured()) {
    res.status(503).json({ error: 'Order cancellation not configured (PRIVATE_KEY not set)' });
    return;
  }
  try {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) {
      res.status(400).json({ error: 'Missing orderId' });
      return;
    }
    await cancelOrder(orderId);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Trading] cancel order error:', err);
    res.status(500).json({ error: msg });
  }
});

router.post('/housekeeping', async (_req: Request, res: Response) => {
  if (!isClobConfigured()) {
    res.status(503).json({ error: 'Housekeeping not configured (PRIVATE_KEY not set)' });
    return;
  }
  try {
    const result = await runHousekeeping();
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Trading] housekeeping error:', err);
    res.status(500).json({ error: msg });
  }
});

router.post('/config', (req: Request, res: Response) => {
  const { privateKey } = req.body as { privateKey?: string };
  setPrivateKey(privateKey ?? null);
  res.json({ ok: true, configured: isClobConfigured() });
});

router.get('/status', (_req: Request, res: Response) => {
  const clobOk = isClobConfigured();
  res.json({
    service: 'polymarket-service',
    running: true,
    clob: clobOk ? 'configured' : 'not_configured',
    brain: BRAIN_URL ? 'configured' : 'not_configured',
  });
});

router.get('/trades', (_req: Request, res: Response) => {
  res.json({ trades: [] });
});

router.post('/start', (req: Request, res: Response) => {
  proxyToBrain('POST', '/start', req, res);
});

router.post('/stop', (req: Request, res: Response) => {
  proxyToBrain('POST', '/stop', req, res);
});

router.post('/sniper/start', (req: Request, res: Response) => {
  proxyToBrain('POST', '/start', req, res);
});

router.post('/sniper/stop', (req: Request, res: Response) => {
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
