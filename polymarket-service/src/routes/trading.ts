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

function requireTradingAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.POLYMARKET_TRADING_API_KEY;
  const allowUnauth =
    process.env.ALLOW_UNAUTHENTICATED_TRADING === 'true' || process.env.ALLOW_UNAUTHENTICATED_TRADING === '1';
  if (!apiKey && allowUnauth) {
    next(); // explicit opt-in for local/dev when POLYMARKET_TRADING_API_KEY is unset
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

/**
 * POST /lp/fill-order – Cross-chain LP fill-or-revert.
 * Place limit SELL on Polymarket; poll up to expiryMs; if filled return success, else cancel and return error.
 */
const DEFAULT_FILL_EXPIRY_MS = 1800;
const FILL_POLL_INTERVAL_MS = 250;

router.post('/lp/fill-order', requireTradingAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    privateKey?: string;
    tokenId?: string;
    amount?: number;
    size?: number;
    requestedPrice?: number;
    slippage?: number;
    expiryMs?: number;
  };
  const pk = body.privateKey?.trim() || null;
  if (!pk) {
    res.status(400).json({ error: 'privateKey is required in request body' });
    return;
  }
  if (!isValidHexPrivateKey(pk)) {
    res.status(400).json({ error: 'privateKey must be a 32-byte hex string (64 hex chars or 66 with 0x prefix)' });
    return;
  }
  const tokenId = body.tokenId?.trim();
  const size = body.size ?? body.amount;
  const requestedPrice = body.requestedPrice != null ? Number(body.requestedPrice) : NaN;
  const expiryMs = Math.min(Math.max(Number(body.expiryMs) || DEFAULT_FILL_EXPIRY_MS, 500), 10000);

  if (!tokenId || size == null || !Number.isFinite(requestedPrice) || requestedPrice <= 0) {
    res.status(400).json({
      error: 'Missing or invalid required fields: tokenId, amount/size, requestedPrice (positive number)',
    });
    return;
  }
  const sizeNum = Number(size);
  if (!Number.isFinite(sizeNum) || sizeNum < 1 || sizeNum !== Math.floor(sizeNum)) {
    res.status(400).json({
      error: 'amount/size must be a positive integer >= 1 (fractional sizes not supported)',
    });
    return;
  }

  let orderId: string | null = null;
  const cancelAndRespond = async (
    status: number,
    body: { filled?: boolean; error?: string; orderId?: string }
  ): Promise<void> => {
    if (orderId) {
      try {
        await cancelOrder(orderId, pk);
      } catch (cancelErr) {
        console.error('[Trading] lp/fill-order cancel failed:', orderId, cancelErr);
        body.error = body.error ?? (cancelErr instanceof Error ? cancelErr.message : 'Cancel failed');
      }
    }
    res.status(status).json(body);
  };

  try {
    const placed = await placeOrder(
      {
        tokenId,
        side: 'SELL',
        price: requestedPrice,
        size: sizeNum,
      },
      pk,
    );
    orderId = placed.orderId;

    const deadline = Date.now() + expiryMs;
    let filled = false;
    try {
      while (Date.now() < deadline) {
        const open = await getOpenOrders({ asset_id: tokenId }, pk);
        const stillOpen = open.some((o) => o.id === orderId);
        if (!stillOpen) {
          filled = true;
          break;
        }
        await new Promise((r) => setTimeout(r, FILL_POLL_INTERVAL_MS));
      }
    } catch (pollErr) {
      await cancelAndRespond(500, {
        filled: false,
        error: pollErr instanceof Error ? pollErr.message : 'Unknown error',
        orderId: orderId ?? undefined,
      });
      return;
    }

    if (filled) {
      res.status(200).json({ filled: true, orderId });
      return;
    }

    await cancelAndRespond(408, {
      filled: false,
      error: 'Order did not fill within expiry',
      orderId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Trading] lp/fill-order error:', err);
    await cancelAndRespond(500, { filled: false, error: msg, orderId: orderId ?? undefined });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    service: 'polymarket-service',
    running: true,
    clob: 'requires_private_key_in_body',
  });
});

router.get('/trades', (_req: Request, res: Response) => {
  res.json({ trades: [] });
});

export default router;
