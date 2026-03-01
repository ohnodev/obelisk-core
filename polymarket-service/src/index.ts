import dotenv from 'dotenv';
dotenv.config();

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
app.use('/api/trading', tradingRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, async () => {
  console.log(`Polymarket service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  await startCache();
  startModel();
  startZMoveModel();
  await startObservations();
});

async function shutdown() {
  console.log('[Shutdown] Graceful shutdown...');
  await stopObservations();
  stopCache();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
