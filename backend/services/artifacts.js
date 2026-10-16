/**
 * Carga (y recarga en caliente) los artefactos que publica el ETL.
 *
 * El backend no calcula nada del ETL: solo sirve lo que Python dejó en
 * `data/processed/`. Si el ETL vuelve a correr —por ejemplo cada 10 minutos
 * con datos en vivo— este módulo detecta el cambio de mtime y recarga sin
 * reiniciar el proceso.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/** @typedef {{ meta: object|null, grid: object|null, stations: object|null, report: object|null, analytics: object|null, runs: object|null, icaScale: object|null }} Artifacts */

const FILES = {
  meta: 'meta.json',
  grid: 'grid.json',
  stations: 'stations.json',
  report: 'etl_report.json',
  analytics: 'analytics.json',
  runs: 'runs.json',
  icaScale: 'ica_scale.json',
};

/** @type {Artifacts} */
const cache = {
  meta: null, grid: null, stations: null, report: null, analytics: null, runs: null, icaScale: null,
};
const mtimes = new Map();
let lastCheck = 0;
let loadedAt = null;
let missing = Object.keys(FILES);

async function readIfChanged(key) {
  const file = path.join(config.processedDir, FILES[key]);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    cache[key] = null;
    mtimes.delete(key);
    return false;
  }
  const stamp = stat.mtimeMs;
  if (mtimes.get(key) === stamp) return false;
  try {
    cache[key] = JSON.parse(await fs.readFile(file, 'utf8'));
    mtimes.set(key, stamp);
    return true;
  } catch (error) {
    console.error(`[artifacts] ${FILES[key]} ilegible: ${error.message}`);
    cache[key] = null;
    return false;
  }
}

/** Recarga los artefactos que hayan cambiado. Devuelve las claves actualizadas. */
export async function refresh({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastCheck < config.reloadIntervalMs) return [];
  lastCheck = now;
  const changed = [];
  for (const key of Object.keys(FILES)) {
    if (await readIfChanged(key)) changed.push(key);
  }
  missing = Object.keys(FILES).filter((key) => cache[key] === null);
  if (changed.length) {
    loadedAt = new Date().toISOString();
    console.log(`[artifacts] recargados: ${changed.join(', ')}`);
  }
  return changed;
}

/** Devuelve el artefacto pedido, recargando si toca. */
export async function get(key) {
  await refresh();
  return cache[key];
}

/** `true` cuando el ETL ya publicó lo mínimo para responder consultas. */
export async function isReady() {
  await refresh();
  return Boolean(cache.grid && cache.stations);
}

export async function status() {
  await refresh();
  return {
    listo: Boolean(cache.grid && cache.stations),
    carpeta: config.processedDir,
    cargado_en: loadedAt,
    faltantes: missing,
    snapshot: cache.meta?.snapshot ?? null,
    generado_en: cache.meta?.generado_en ?? null,
    fuente: cache.meta?.fuente ?? null,
    metodos: cache.meta?.metodos ?? null,
  };
}

/** Mensaje único para cuando todavía no se ha corrido el ETL. */
export function notReadyPayload() {
  return {
    error: 'etl_no_ejecutado',
    mensaje:
      'Todavía no hay artefactos del ETL. Ejecuta `python -m etl.run` en la raíz del proyecto ' +
      'para generar data/processed/grid.json y stations.json.',
    carpeta: config.processedDir,
    faltantes: missing,
  };
}
