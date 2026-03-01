import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WINDOW_SEC, extractWindowTs } from '../utils/windowUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DATA_FILE = join(DATA_DIR, 'market-observations.json');
const CHUNKS_DIR = join(DATA_DIR, 'market-observations');

const SAVE_INTERVAL_MS = 60_000;
const MAX_IN_MEMORY_OBSERVATIONS = 5000;
const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

export interface MarketObservation {
  t: number;
  tr: number;
  dist: number;
  mkt: number;
  w: number;
  z?: number;
  btc?: number;
}

function isValidMarketObservation(o: unknown): o is MarketObservation {
  if (o === null || typeof o !== 'object') return false;
  const obj = o as Record<string, unknown>;
  return (
    typeof obj.t === 'number' && obj.t > 0 &&
    typeof obj.tr === 'number' &&
    typeof obj.dist === 'number' &&
    typeof obj.mkt === 'number' &&
    typeof obj.w === 'number' &&
    (obj.z === undefined || typeof obj.z === 'number') &&
    (obj.btc === undefined || typeof obj.btc === 'number')
  );
}

const observations: MarketObservation[] = [];
const pendingObservations: MarketObservation[] = [];
let saveTimer: ReturnType<typeof setInterval> | null = null;

function observationSecondKey(o: MarketObservation): string {
  return `${o.w}:${o.t}`;
}

function dedupeByWindowSecond(input: MarketObservation[]): { deduped: MarketObservation[]; changed: boolean } {
  const byKey = new Map<string, MarketObservation>();
  for (const obs of input) byKey.set(observationSecondKey(obs), obs);
  const deduped = Array.from(byKey.values()).sort((a, b) => a.t - b.t);
  return { deduped, changed: deduped.length !== input.length };
}

function upsertLatestBySecond(target: MarketObservation[], observation: MarketObservation): void {
  const key = observationSecondKey(observation);
  for (let i = target.length - 1; i >= 0; i--) {
    if (observationSecondKey(target[i]) === key) {
      target[i] = observation;
      return;
    }
  }
  target.push(observation);
}

function utcDayFromUnixSec(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function parseUtcDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12) return null;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function normalizeUtcDayRange(from?: string, to?: string): { from?: string; to?: string } {
  const parsedFrom = from ? parseUtcDay(from) : null;
  const parsedTo = to ? parseUtcDay(to) : null;
  if (from && !parsedFrom) throw new Error(`Invalid from date "${from}"`);
  if (to && !parsedTo) throw new Error(`Invalid to date "${to}"`);
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    throw new Error(`Invalid range: from "${from}" is after to "${to}"`);
  }
  return { from, to };
}

async function readChunkFile(path: string): Promise<MarketObservation[]> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as { observations?: unknown[] };
    if (!Array.isArray(parsed.observations)) return [];
    return parsed.observations.filter(isValidMarketObservation);
  } catch {
    return [];
  }
}

async function readLegacyObservations(): Promise<MarketObservation[]> {
  try {
    const raw = await readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { observations?: unknown[] };
    if (!Array.isArray(parsed.observations)) return [];
    return parsed.observations.filter(isValidMarketObservation);
  } catch {
    return [];
  }
}

async function listDayFiles(): Promise<string[]> {
  try {
    const names = await readdir(CHUNKS_DIR);
    return names.filter((name) => DAY_FILE_RE.test(name)).sort();
  } catch {
    return [];
  }
}

export function recordObservation(
  slug: string | null,
  btcPrice: number | null,
  priceToBeat: number | null,
  marketUpPrice: number | null,
): void {
  if (!slug || btcPrice === null || priceToBeat === null || marketUpPrice === null) return;
  if (priceToBeat <= 0) return;

  const windowTs = extractWindowTs(slug);
  if (windowTs === null) return;

  const now = Date.now() / 1000;
  const timeRemaining = Math.max(0, windowTs + WINDOW_SEC - now);
  if (timeRemaining <= 0) return;

  const distancePct = ((btcPrice - priceToBeat) / priceToBeat) * 100;
  const distRounded = Math.round(distancePct * 10000) / 10000;

  const observation: MarketObservation = {
    t: Math.round(now),
    tr: Math.round(timeRemaining),
    dist: distRounded,
    mkt: Math.round(marketUpPrice * 10000) / 10000,
    w: windowTs,
    btc: Math.round(btcPrice * 100) / 100,
  };
  upsertLatestBySecond(observations, observation);
  upsertLatestBySecond(pendingObservations, observation);

  while (observations.length > MAX_IN_MEMORY_OBSERVATIONS) {
    observations.shift();
  }
}

async function loadFromDisk(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const todayPath = join(CHUNKS_DIR, `${today}.json`);

  const fromToday = await readChunkFile(todayPath);
  const source = fromToday.length > 0 ? fromToday : await readLegacyObservations();
  if (source.length === 0) return;

  const restored = source.slice(-MAX_IN_MEMORY_OBSERVATIONS);
  const { deduped: restoredDeduped } = dedupeByWindowSecond(restored);
  observations.length = 0;
  observations.push(...restoredDeduped);
  console.log(`[MarketObs] Loaded ${observations.length} observations into memory`);
}

async function saveDayChunk(day: string, entries: MarketObservation[]): Promise<void> {
  if (entries.length === 0) return;

  const path = join(CHUNKS_DIR, `${day}.json`);
  const existing = await readChunkFile(path);
  const mergedByKey = new Map<string, MarketObservation>();
  for (const obs of existing) mergedByKey.set(observationSecondKey(obs), obs);
  for (const obs of entries) mergedByKey.set(observationSecondKey(obs), obs);
  const merged = Array.from(mergedByKey.values()).sort((a, b) => a.t - b.t);

  const tmp = `${path}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ savedAt: Date.now(), observations: merged }));
    await rename(tmp, path);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      // Best-effort temp cleanup only.
    }
    throw err;
  }
}

async function compactAllDayChunks(): Promise<void> {
  const files = await listDayFiles();
  if (files.length === 0) return;
  for (const file of files) {
    const path = join(CHUNKS_DIR, file);
    const existing = await readChunkFile(path);
    if (existing.length === 0) continue;
    const { deduped, changed } = dedupeByWindowSecond(existing);
    if (!changed) continue;
    const tmp = `${path}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify({ savedAt: Date.now(), observations: deduped }));
      await rename(tmp, path);
      console.log(`[MarketObs] Compacted ${file}: ${existing.length} -> ${deduped.length}`);
    } catch (err) {
      try {
        await unlink(tmp);
      } catch {
        // Best-effort temp cleanup only.
      }
      console.error(`[MarketObs] Failed to compact ${file}:`, err);
    }
  }
}

async function persistPending(): Promise<void> {
  if (pendingObservations.length === 0) return;

  const snapshot = pendingObservations.splice(0);
  const byDay = new Map<string, MarketObservation[]>();
  for (const obs of snapshot) {
    const day = utcDayFromUnixSec(obs.t);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(obs);
    else byDay.set(day, [obs]);
  }

  const failed: MarketObservation[] = [];
  for (const [day, entries] of byDay.entries()) {
    try {
      await saveDayChunk(day, entries);
    } catch (err) {
      console.error(`[MarketObs] Failed to persist day ${day}:`, err);
      failed.push(...entries);
    }
  }

  if (failed.length > 0) {
    for (const obs of failed) pendingObservations.push(obs);
  }
}

async function saveToDisk(): Promise<void> {
  try {
    await mkdir(CHUNKS_DIR, { recursive: true });
    await persistPending();
  } catch (err) {
    console.error('[MarketObs] Failed to save:', err);
  }
}

export async function startObservations(): Promise<void> {
  await mkdir(CHUNKS_DIR, { recursive: true });
  await compactAllDayChunks();
  await loadFromDisk();
  saveTimer = setInterval(() => { void saveToDisk(); }, SAVE_INTERVAL_MS);
  console.log(`[MarketObs] Started — save every ${SAVE_INTERVAL_MS / 1000}s`);
}

export async function stopObservations(): Promise<void> {
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = null;
  await saveToDisk();
  console.log('[MarketObs] Stopped');
}

export function getObservations(): MarketObservation[] {
  return observations.slice();
}

export function getObservationCount(): number {
  return observations.length;
}

export async function getObservationHistory(from?: string, to?: string): Promise<MarketObservation[]> {
  const range = normalizeUtcDayRange(from, to);
  const files = await listDayFiles();
  if (files.length === 0) {
    const all = await readLegacyObservations();
    const filtered = all.filter((obs) => {
      const day = utcDayFromUnixSec(obs.t);
      if (range.from && day < range.from) return false;
      if (range.to && day > range.to) return false;
      return true;
    });
    return dedupeByWindowSecond(filtered).deduped;
  }

  const selected = files.filter((name) => {
    const day = name.slice(0, 10);
    if (range.from && day < range.from) return false;
    if (range.to && day > range.to) return false;
    return true;
  });

  const chunks = await Promise.all(
    selected.map((file) => readChunkFile(join(CHUNKS_DIR, file))),
  );
  const merged = chunks.reduce<MarketObservation[]>((acc, chunk) => acc.concat(chunk), []);
  return dedupeByWindowSecond(merged).deduped;
}
