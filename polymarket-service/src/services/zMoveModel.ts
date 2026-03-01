import { WINDOW_SEC } from '../utils/windowUtils.js';
import { getObservations, type MarketObservation } from './marketObservations.js';
import type { ModelConfig, SurfaceData } from './probabilityModel.js';

const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
const DEFAULT_DEFF_MIN = -1.0;
const DEFAULT_DEFF_MAX = 1.0;
const DEFAULT_DEFF_STEP = 0.01;
const DEFAULT_TIME_STEP_SEC = 3;
const DEFAULT_SIGMA = 0.2;
const DEFAULT_VOL_DECAY = 0.5;

const MIN_WINDOW_SEC = 30;
const MAX_WINDOW_SEC = 3600;
const MIN_AXIS_BOUND = -3.0;
const MAX_AXIS_BOUND = 3.0;
const MIN_AXIS_STEP = 0.001;
const MAX_AXIS_STEP = 0.2;
const MIN_TIME_STEP_SEC = 1;
const MAX_TIME_STEP_SEC = 60;

const DERIVATIVE_LOOKBACK_SEC = 12;
const DERIVATIVE_MIN_SPAN_SEC = 3;
const DERIVATIVE_MIN_POINTS = 3;
const DERIVATIVE_CLAMP_ABS = 0.05;
const DT_EPS = 1e-6;
const DEFAULT_BETA = 1.8;
const MIN_BETA = 0.1;
const MAX_BETA = 4.0;

let modelConfig: ModelConfig = {
  sigma: DEFAULT_SIGMA,
  volDecay: DEFAULT_VOL_DECAY,
  windowSec: WINDOW_SEC,
  distanceMin: DEFAULT_DEFF_MIN,
  distanceMax: DEFAULT_DEFF_MAX,
  distanceStep: DEFAULT_DEFF_STEP,
  timeStepSec: DEFAULT_TIME_STEP_SEC,
  beta: DEFAULT_BETA,
};

let cachedSurface: SurfaceData | null = null;
let cachedAt = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sanitizeConfig(input?: Partial<ModelConfig>): ModelConfig {
  const sigma = clamp(input?.sigma ?? modelConfig.sigma, 0.01, 3.0);
  const volDecay = clamp(input?.volDecay ?? modelConfig.volDecay, 0, 3.0);
  const beta = clamp(input?.beta ?? modelConfig.beta ?? DEFAULT_BETA, MIN_BETA, MAX_BETA);
  const windowSec = Math.round(clamp(input?.windowSec ?? modelConfig.windowSec, MIN_WINDOW_SEC, MAX_WINDOW_SEC));
  const distanceMinRaw = clamp(input?.distanceMin ?? modelConfig.distanceMin, MIN_AXIS_BOUND, MAX_AXIS_BOUND);
  const distanceMaxRaw = clamp(input?.distanceMax ?? modelConfig.distanceMax, MIN_AXIS_BOUND, MAX_AXIS_BOUND);
  const distanceStep = clamp(input?.distanceStep ?? modelConfig.distanceStep, MIN_AXIS_STEP, MAX_AXIS_STEP);
  const timeStepSec = Math.round(clamp(input?.timeStepSec ?? modelConfig.timeStepSec, MIN_TIME_STEP_SEC, MAX_TIME_STEP_SEC));

  return {
    sigma,
    volDecay,
    beta,
    windowSec,
    distanceMin: Math.min(distanceMinRaw, distanceMaxRaw),
    distanceMax: Math.max(distanceMinRaw, distanceMaxRaw),
    distanceStep,
    timeStepSec,
  };
}

function buildAxis(min: number, max: number, step: number): number[] {
  const axis: number[] = [];
  const span = Math.max(0, max - min);
  const nSteps = Math.floor(span / step + 1e-9);
  for (let i = 0; i <= nSteps; i++) {
    axis.push(Math.round((min + i * step) * 1000) / 1000);
  }
  const roundedMax = Math.round(max * 1000) / 1000;
  if (axis[axis.length - 1] !== roundedMax) axis.push(roundedMax);
  return axis;
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

function effectiveVol(config: ModelConfig, timeRemainingSec: number): number {
  const frac = timeRemainingSec / config.windowSec;
  return config.sigma * Math.pow(Math.max(frac, 1e-9), config.volDecay);
}

function gbmProb(distanceLikePct: number, timeRemainingSec: number, config: ModelConfig): number {
  if (timeRemainingSec <= 0) {
    if (distanceLikePct > 0) return 1;
    if (distanceLikePct < 0) return 0;
    return 0.5;
  }

  // Clamp far from -100% to avoid log-domain issues.
  const dPct = Math.max(distanceLikePct, -99.0);
  const vol = effectiveVol(config, timeRemainingSec);
  const T = timeRemainingSec / SECONDS_PER_YEAR;
  const logRatio = Math.log(1 + dPct / 100);
  const sqrtT = Math.sqrt(T);
  const d = (logRatio - (vol * vol * T) / 2) / Math.max(vol * sqrtT, 1e-12);
  return normalCDF(d);
}

interface ZMoveSample {
  tr: number;
  deff: number;
  mkt: number;
}

function robustDistanceDerivative(points: MarketObservation[], idx: number): number {
  const current = points[idx];
  const thresholdTs = current.t - DERIVATIVE_LOOKBACK_SEC;
  const window: MarketObservation[] = [];
  for (let i = idx; i >= 0; i--) {
    if (points[i].t < thresholdTs) break;
    window.push(points[i]);
  }
  window.reverse();

  if (window.length >= DERIVATIVE_MIN_POINTS) {
    const span = window[window.length - 1].t - window[0].t;
    if (span >= DERIVATIVE_MIN_SPAN_SEC) {
      const t0 = window[0].t;
      const meanT = window.reduce((acc, p) => acc + (p.t - t0), 0) / window.length;
      const meanD = window.reduce((acc, p) => acc + p.dist, 0) / window.length;
      let cov = 0;
      let varT = 0;
      for (const p of window) {
        const dt = (p.t - t0) - meanT;
        const dd = p.dist - meanD;
        cov += dt * dd;
        varT += dt * dt;
      }
      if (varT > DT_EPS) {
        return clamp(cov / varT, -DERIVATIVE_CLAMP_ABS, DERIVATIVE_CLAMP_ABS);
      }
    }
  }

  // Fallback to the earliest point with enough separation.
  for (let i = idx - 1; i >= 0; i--) {
    const dt = current.t - points[i].t;
    if (dt >= 1) {
      return clamp((current.dist - points[i].dist) / dt, -DERIVATIVE_CLAMP_ABS, DERIVATIVE_CLAMP_ABS);
    }
  }
  return 0;
}

function toMomentumAdjustedDistance(distance: number, derivative: number, momentumAlpha: number): number {
  return distance + momentumAlpha * derivative * DERIVATIVE_LOOKBACK_SEC;
}

function buildSamples(observations: MarketObservation[], config: ModelConfig): ZMoveSample[] {
  const byWindow = new Map<number, MarketObservation[]>();
  for (const obs of observations) {
    const bucket = byWindow.get(obs.w);
    if (bucket) bucket.push(obs);
    else byWindow.set(obs.w, [obs]);
  }

  const samples: ZMoveSample[] = [];
  for (const windowObs of byWindow.values()) {
    windowObs.sort((a, b) => a.t - b.t);
    for (let i = 0; i < windowObs.length; i++) {
      const current = windowObs[i];
      const derivative = robustDistanceDerivative(windowObs, i);
      const deff = toMomentumAdjustedDistance(current.dist, derivative, config.volDecay);
      samples.push({ tr: current.tr, deff, mkt: clamp01(current.mkt) });
    }
  }
  return samples;
}

function computeSurface(config: ModelConfig): SurfaceData {
  const timeAxis = buildAxis(0, config.windowSec, config.timeStepSec);
  const deffAxis = buildAxis(config.distanceMin, config.distanceMax, config.distanceStep);
  const beta = config.beta ?? DEFAULT_BETA;
  const probabilities: number[][] = timeAxis.map((tr) =>
    deffAxis.map((deff) => gbmProb(beta * deff, tr, config)),
  );

  return {
    sigma: config.sigma,
    volDecay: config.volDecay,
    timeAxis,
    distanceAxis: deffAxis,
    probabilities,
    computedAt: Date.now(),
  };
}

function currentDerivative(windowTs: number, currentDistancePct: number): number {
  const sameWindow = getObservations()
    .filter((o) => o.w === windowTs)
    .sort((a, b) => a.t - b.t);
  const nowSec = Math.round(Date.now() / 1000);
  const liveSeries = sameWindow.concat({
    t: nowSec,
    tr: 0,
    dist: currentDistancePct,
    mkt: 0.5,
    w: windowTs,
  });
  if (liveSeries.length <= 1) return 0;
  return robustDistanceDerivative(liveSeries, liveSeries.length - 1);
}

function currentDEff(windowTs: number, distancePct: number, momentumAlpha: number): number {
  const derivative = currentDerivative(windowTs, distancePct);
  return toMomentumAdjustedDistance(distancePct, derivative, momentumAlpha);
}

function resolveSurface(input?: Partial<ModelConfig>): SurfaceData {
  if (input) return computeSurface(sanitizeConfig(input));
  const stale = Date.now() - cachedAt > 15_000;
  if (!cachedSurface || stale) {
    cachedSurface = computeSurface(modelConfig);
    cachedAt = Date.now();
  }
  return cachedSurface;
}

export function getZMoveSurface(input?: Partial<ModelConfig>): SurfaceData {
  const s = resolveSurface(input);
  return {
    sigma: s.sigma,
    volDecay: s.volDecay,
    timeAxis: s.timeAxis.slice(),
    distanceAxis: s.distanceAxis.slice(),
    probabilities: s.probabilities.map((r) => r.slice()),
    computedAt: s.computedAt,
  };
}

export function getZMoveModelConfig(): ModelConfig {
  return { ...modelConfig };
}

export function getZMoveModelStatus() {
  const s = resolveSurface();
  return {
    sigma: modelConfig.sigma,
    volDecay: modelConfig.volDecay,
    beta: modelConfig.beta ?? DEFAULT_BETA,
    gridRows: s.timeAxis.length,
    gridCols: s.distanceAxis.length,
    totalCells: s.timeAxis.length * s.distanceAxis.length,
    computedAt: s.computedAt,
    windowSec: modelConfig.windowSec,
    timeStepSec: modelConfig.timeStepSec,
    distanceRange: {
      min: s.distanceAxis[0] ?? modelConfig.distanceMin,
      max: s.distanceAxis[s.distanceAxis.length - 1] ?? modelConfig.distanceMax,
      step: modelConfig.distanceStep,
    },
  };
}

export function getZMoveProbabilityForPoint(distancePct: number, timeRemainingSec: number, windowTs: number): number {
  const tr = clamp(timeRemainingSec, 0, modelConfig.windowSec);
  const deff = currentDEff(windowTs, distancePct, modelConfig.volDecay);
  const beta = modelConfig.beta ?? DEFAULT_BETA;
  return clamp01(gbmProb(beta * deff, tr, modelConfig));
}

export function getCurrentZMove(distancePct: number, windowTs: number): number {
  return currentDEff(windowTs, distancePct, modelConfig.volDecay);
}

export function getZMoveObservations(): Array<{ tr: number; z: number; mkt: number }> {
  const samples = buildSamples(getObservations(), modelConfig);
  return samples.map((s) => ({
    tr: s.tr,
    z: s.deff,
    mkt: s.mkt,
  }));
}

export function startZMoveModel(): void {
  modelConfig = sanitizeConfig({
    windowSec: WINDOW_SEC,
    distanceMin: DEFAULT_DEFF_MIN,
    distanceMax: DEFAULT_DEFF_MAX,
    distanceStep: DEFAULT_DEFF_STEP,
    timeStepSec: DEFAULT_TIME_STEP_SEC,
    beta: DEFAULT_BETA,
  });
  cachedSurface = computeSurface(modelConfig);
  cachedAt = Date.now();
  console.log(
    `[ZMoveModel] Surface computed (${cachedSurface.timeAxis.length}x${cachedSurface.distanceAxis.length})`,
  );
}
