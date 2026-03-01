import { Router, type Request, type Response } from 'express';
import {
  getSurface,
  getModelConfig,
  getModelStatus,
  ModelConfigValidationError,
  type ModelConfig,
} from '../services/probabilityModel.js';
import { getObservationCount, getObservationHistory, getObservations } from '../services/marketObservations.js';
import {
  getZMoveModelConfig,
  getZMoveModelStatus,
  getZMoveObservations,
  getZMoveSurface,
} from '../services/zMoveModel.js';

const router = Router();
type ModelKey = 'gbm' | 'zmove';

function parseNum(v: unknown): number | undefined {
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function surfaceQueryToConfig(req: Request): Partial<ModelConfig> | undefined {
  const read = (key: keyof ModelConfig): number | undefined => {
    const raw = req.query[key];
    const parsed = parseNum(raw);
    if (raw !== undefined && parsed === undefined) {
      throw new ModelConfigValidationError(`Invalid query parameter "${key}": ${String(raw)}`);
    }
    return parsed;
  };
  const cfg: Partial<ModelConfig> = {
    sigma: read('sigma'),
    volDecay: read('volDecay'),
    beta: read('beta'),
    windowSec: read('windowSec'),
    distanceMin: read('distanceMin'),
    distanceMax: read('distanceMax'),
    distanceStep: read('distanceStep'),
    timeStepSec: read('timeStepSec'),
  };
  const hasAny = Object.values(cfg).some((v) => v !== undefined);
  return hasAny ? cfg : undefined;
}

function getModelKey(req: Request): ModelKey {
  const value = typeof req.query.model === 'string' ? req.query.model.toLowerCase() : 'gbm';
  if (value === 'gbm' || value === 'zmove') return value;
  throw new ModelConfigValidationError(`Invalid model "${value}"`);
}

router.get('/surface', (req: Request, res: Response) => {
  try {
    const model = getModelKey(req);
    const cfg = surfaceQueryToConfig(req);
    res.set('Cache-Control', cfg ? 'no-store' : 'public, max-age=60');
    if (model === 'zmove') {
      res.json(getZMoveSurface(cfg));
      return;
    }
    res.json(getSurface(cfg));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ModelConfigValidationError) {
      res.status(400).json({ error: 'Invalid surface configuration', details: message });
      return;
    }
    console.error('[ModelRoute] Failed to compute surface', { error: err, message });
    res.status(500).json({ error: 'Failed to compute surface' });
  }
});

router.get('/config', (_req: Request, res: Response) => {
  try {
    const model = getModelKey(_req);
    res.set('Cache-Control', 'no-store');
    if (model === 'zmove') {
      res.json(getZMoveModelConfig());
      return;
    }
    res.json(getModelConfig());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: 'Invalid model configuration request', details: message });
  }
});

router.get('/status', (req: Request, res: Response) => {
  try {
    const model = getModelKey(req);
    res.set('Cache-Control', 'no-store');
    if (model === 'zmove') {
      res.json(getZMoveModelStatus());
      return;
    }
    res.json(getModelStatus());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: 'Invalid model status request', details: message });
  }
});

router.get('/observations', (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    const model = getModelKey(req);
    if (model === 'zmove') {
      const observations = getZMoveObservations();
      res.json({ count: observations.length, observations });
      return;
    }
    res.json({ count: getObservationCount(), observations: getObservations() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: 'Invalid observations request', details: message });
  }
});

router.get('/observations/history', async (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const observations = await getObservationHistory(from, to);
    res.json({ count: observations.length, observations });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read observation history';
    res.status(400).json({ error: message });
  }
});

export default router;
