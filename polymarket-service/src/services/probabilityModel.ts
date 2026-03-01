import { WINDOW_SEC } from '../utils/windowUtils.js';

const SECONDS_PER_YEAR = 365.25 * 24 * 3600;

const DEFAULT_SIGMA = 0.2;
const DEFAULT_VOL_DECAY = 0.5;
const DEFAULT_DISTANCE_MIN = -0.30;
const DEFAULT_DISTANCE_MAX = 0.30;
const DEFAULT_DISTANCE_STEP = 0.01;
const DEFAULT_TIME_STEP_SEC = 1;

export interface ModelConfig {
  sigma: number;
  volDecay: number;
  beta?: number;
  windowSec: number;
  distanceMin: number;
  distanceMax: number;
  distanceStep: number;
  timeStepSec: number;
}

export interface SurfaceData {
  sigma: number;
  volDecay: number;
  timeAxis: number[];
  distanceAxis: number[];
  probabilities: number[][];
  computedAt: number;
}

const MIN_SIGMA = 0.01;
const MAX_SIGMA = 3.0;
const MIN_VOL_DECAY = 0.0;
const MAX_VOL_DECAY = 3.0;
const MIN_WINDOW_SEC = 30;
const MAX_WINDOW_SEC = 3600;
const MIN_DISTANCE_BOUND = -5.0;
const MAX_DISTANCE_BOUND = 5.0;
const MIN_DISTANCE_STEP = 0.001;
const MAX_DISTANCE_STEP = 1.0;
const MIN_TIME_STEP_SEC = 1;
const MAX_TIME_STEP_SEC = 60;
const MAX_SURFACE_CELLS = 1_000_000;
const MAX_COMPUTE_SURFACE_CELLS = 200_000;

export class ModelConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigValidationError';
  }
}

let modelConfig: ModelConfig = {
  sigma: DEFAULT_SIGMA,
  volDecay: DEFAULT_VOL_DECAY,
  windowSec: WINDOW_SEC,
  distanceMin: DEFAULT_DISTANCE_MIN,
  distanceMax: DEFAULT_DISTANCE_MAX,
  distanceStep: DEFAULT_DISTANCE_STEP,
  timeStepSec: DEFAULT_TIME_STEP_SEC,
};

let cachedSurface: SurfaceData | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeConfig(input?: Partial<ModelConfig>): ModelConfig {
  const sigma = clamp(input?.sigma ?? modelConfig.sigma, MIN_SIGMA, MAX_SIGMA);
  const volDecay = clamp(input?.volDecay ?? modelConfig.volDecay, MIN_VOL_DECAY, MAX_VOL_DECAY);
  const windowSec = Math.round(clamp(input?.windowSec ?? modelConfig.windowSec, MIN_WINDOW_SEC, MAX_WINDOW_SEC));
  const distanceMinRaw = clamp(input?.distanceMin ?? modelConfig.distanceMin, MIN_DISTANCE_BOUND, MAX_DISTANCE_BOUND);
  const distanceMaxRaw = clamp(input?.distanceMax ?? modelConfig.distanceMax, MIN_DISTANCE_BOUND, MAX_DISTANCE_BOUND);
  const distanceStep = clamp(input?.distanceStep ?? modelConfig.distanceStep, MIN_DISTANCE_STEP, MAX_DISTANCE_STEP);
  const timeStepSec = Math.round(clamp(input?.timeStepSec ?? modelConfig.timeStepSec, MIN_TIME_STEP_SEC, MAX_TIME_STEP_SEC));
  const distanceMin = Math.min(distanceMinRaw, distanceMaxRaw);
  const distanceMax = Math.max(distanceMinRaw, distanceMaxRaw);
  const distanceRange = Math.max(0, distanceMax - distanceMin);
  const timePoints = Math.ceil(windowSec / timeStepSec - 1e-9) + 1;
  const distancePoints = Math.ceil(distanceRange / distanceStep - 1e-9) + 1;
  const totalCells = timePoints * distancePoints;
  if (totalCells > MAX_SURFACE_CELLS) {
    throw new ModelConfigValidationError(
      `Requested grid is too large (${totalCells.toLocaleString()} cells); maximum is ${MAX_SURFACE_CELLS.toLocaleString()}`,
    );
  }
  return {
    sigma,
    volDecay,
    windowSec,
    distanceMin,
    distanceMax,
    distanceStep,
    timeStepSec,
  };
}

function buildTimeAxis(windowSec: number, timeStepSec: number): number[] {
  const axis: number[] = [];
  for (let t = 0; t <= windowSec + 1e-9; t += timeStepSec) {
    axis.push(Math.round(t));
  }
  if (axis[axis.length - 1] !== windowSec) {
    axis.push(windowSec);
  }
  return axis;
}

function buildDistanceAxis(distanceMin: number, distanceMax: number, distanceStep: number): number[] {
  const axis: number[] = [];
  const distanceRange = Math.max(0, distanceMax - distanceMin);
  const nSteps = Math.floor(distanceRange / distanceStep + 1e-9);
  for (let i = 0; i <= nSteps; i++) {
    const d = distanceMin + i * distanceStep;
    axis.push(Math.round(d * 1000) / 1000);
  }
  const roundedMax = Math.round(distanceMax * 1000) / 1000;
  if (axis[axis.length - 1] !== roundedMax) {
    axis.push(roundedMax);
  }
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

function gbmProb(distancePct: number, timeRemainingSec: number, config: ModelConfig): number {
  if (timeRemainingSec <= 0) {
    if (distancePct > 0) return 1;
    if (distancePct < 0) return 0;
    return 0.5;
  }

  const vol = effectiveVol(config, timeRemainingSec);
  const T = timeRemainingSec / SECONDS_PER_YEAR;
  const logRatio = Math.log(1 + distancePct / 100);
  const sqrtT = Math.sqrt(T);
  const d = (logRatio - (vol * vol * T) / 2) / (vol * sqrtT);
  return normalCDF(d);
}

/** Returns GBM P(Up) for a single (distancePct, timeRemainingSec) for use in snapshot/API. */
export function getProbabilityForPoint(distancePct: number, timeRemainingSec: number): number {
  return gbmProb(distancePct, timeRemainingSec, modelConfig);
}

function computeSurfaceForConfig(config: ModelConfig): SurfaceData {
  const distanceRange = Math.max(0, config.distanceMax - config.distanceMin);
  const estimatedTimeLen = Math.floor(config.windowSec / config.timeStepSec + 1e-9) + 1;
  const estimatedDistLen = Math.floor(distanceRange / config.distanceStep + 1e-9) + 1;
  const estimatedCells = estimatedTimeLen * estimatedDistLen;

  let effectiveTimeStep = config.timeStepSec;
  let effectiveDistanceStep = config.distanceStep;
  if (estimatedCells > MAX_COMPUTE_SURFACE_CELLS) {
    const scale = Math.sqrt(estimatedCells / MAX_COMPUTE_SURFACE_CELLS);
    effectiveTimeStep = Math.min(
      MAX_TIME_STEP_SEC,
      Math.max(MIN_TIME_STEP_SEC, Math.ceil(config.timeStepSec * scale)),
    );
    effectiveDistanceStep = Math.min(
      MAX_DISTANCE_STEP,
      Math.max(MIN_DISTANCE_STEP, config.distanceStep * scale),
    );
    console.warn('[ProbModel] Coarsening requested surface resolution', {
      estimatedCells,
      maxCells: MAX_COMPUTE_SURFACE_CELLS,
      requested: { timeStepSec: config.timeStepSec, distanceStep: config.distanceStep },
      applied: { timeStepSec: effectiveTimeStep, distanceStep: effectiveDistanceStep },
    });
  }
  effectiveDistanceStep = Math.round(effectiveDistanceStep * 1000) / 1000;

  const timeAxis = buildTimeAxis(config.windowSec, effectiveTimeStep);
  const distanceAxis = buildDistanceAxis(config.distanceMin, config.distanceMax, effectiveDistanceStep);
  const grid: number[][] = [];
  for (let ti = 0; ti < timeAxis.length; ti++) {
    const row: number[] = [];
    for (let di = 0; di < distanceAxis.length; di++) {
      row.push(gbmProb(distanceAxis[di], timeAxis[ti], config));
    }
    grid.push(row);
  }
  return {
    sigma: config.sigma,
    volDecay: config.volDecay,
    timeAxis,
    distanceAxis,
    probabilities: grid,
    computedAt: Date.now(),
  };
}

export function startModel(): void {
  modelConfig = sanitizeConfig({ windowSec: WINDOW_SEC });
  cachedSurface = computeSurfaceForConfig(modelConfig);
  console.log(
    `[ProbModel] Surface computed (${cachedSurface.timeAxis.length}x${cachedSurface.distanceAxis.length}, sigma=${modelConfig.sigma}, decay=${modelConfig.volDecay})`,
  );
}

export function getSurface(input?: Partial<ModelConfig>): SurfaceData {
  if (input) {
    // Builder previews intentionally bypass cachedSurface to keep custom parameter runs
    // immutable and predictable per request. This is safe because sanitizeConfig
    // enforces grid-size limits before computeSurfaceForConfig allocates arrays.
    return computeSurfaceForConfig(sanitizeConfig(input));
  }
  if (!cachedSurface) {
    cachedSurface = computeSurfaceForConfig(modelConfig);
  }
  return {
    sigma: cachedSurface.sigma,
    volDecay: cachedSurface.volDecay,
    timeAxis: cachedSurface.timeAxis.slice(),
    distanceAxis: cachedSurface.distanceAxis.slice(),
    probabilities: cachedSurface.probabilities.map(row => row.slice()),
    computedAt: cachedSurface.computedAt,
  };
}

export function getModelConfig(): ModelConfig {
  return { ...modelConfig };
}

export function getModelStatus() {
  if (!cachedSurface) {
    cachedSurface = computeSurfaceForConfig(modelConfig);
  }
  const gridRows = cachedSurface.timeAxis.length;
  const gridCols = cachedSurface.distanceAxis.length;
  const actualTimeStepSec = gridRows > 1 ? Math.max(1, Math.round(cachedSurface.timeAxis[1] - cachedSurface.timeAxis[0])) : modelConfig.timeStepSec;
  const actualDistanceStep = gridCols > 1
    ? Math.round(Math.abs(cachedSurface.distanceAxis[1] - cachedSurface.distanceAxis[0]) * 1000) / 1000
    : modelConfig.distanceStep;
  return {
    sigma: modelConfig.sigma,
    volDecay: modelConfig.volDecay,
    gridRows,
    gridCols,
    totalCells: gridRows * gridCols,
    computedAt: cachedSurface.computedAt,
    windowSec: modelConfig.windowSec,
    timeStepSec: actualTimeStepSec,
    distanceRange: {
      min: cachedSurface.distanceAxis[0] ?? modelConfig.distanceMin,
      max: cachedSurface.distanceAxis[cachedSurface.distanceAxis.length - 1] ?? modelConfig.distanceMax,
      step: actualDistanceStep,
    },
  };
}

export function setSigma(sigma: number): void {
  if (sigma > 0 && Number.isFinite(sigma)) {
    modelConfig = sanitizeConfig({ ...modelConfig, sigma });
    cachedSurface = computeSurfaceForConfig(modelConfig);
  }
}
