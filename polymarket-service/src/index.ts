import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load polymarket-service/.env — cwd (from ecosystem) and __dirname-relative as fallback
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import marketRouter from './routes/market.js';
import modelRouter from './routes/model.js';
import tradingRouter from './routes/trading.js';
import { startCache, stopCache } from './services/marketCache.js';
import { startModel } from './services/probabilityModel.js';
import { startZMoveModel } from './services/zMoveModel.js';
import { startObservations, stopObservations } from './services/marketObservations.js';

const app = express();
const PORT = Number(process.env.PORT) || 1110;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'polymarket-service',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/market', marketRouter);
app.use('/api/model', modelRouter);
// Auth applied per-route in tradingRouter (requireTradingAuth on mutating endpoints)
app.use('/api/trading', tradingRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

let server: ReturnType<typeof app.listen> | null = null;

async function startup(): Promise<void> {
  try {
    await startCache();
    startModel();
    startZMoveModel();
    await startObservations();
  } catch (err) {
    console.error('[Startup] Initialization failed:', err);
    throw err;
  }
}

startup()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`Polymarket service running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  })
  .catch((err) => {
    console.error('[Startup] Aborting:', err);
    process.exit(1);
  });

const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[Shutdown] Graceful shutdown...');
  if (!server) {
    await stopObservations();
    stopCache();
    process.exit(0);
    return;
  }
  const forceExit = setTimeout(() => {
    console.warn('[Shutdown] Forcing exit after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  server.close(async () => {
    clearTimeout(forceExit);
    await stopObservations();
    stopCache();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
