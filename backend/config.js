/**
 * Configuración del backend. Todo sale de variables de entorno con valores por
 * defecto sensatos para desarrollo local.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (value, fallback) =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '127.0.0.1',

  /** Carpeta donde el ETL en Python deja los artefactos. */
  processedDir: process.env.PROCESSED_DIR
    ? path.resolve(process.env.PROCESSED_DIR)
    : path.join(ROOT, 'data', 'processed'),

  /** JSON crudo del SIATA, usado solo por el modo de simulación en vivo. */
  rawFile: process.env.RAW_FILE
    ? path.resolve(process.env.RAW_FILE)
    : path.join(ROOT, 'data', 'raw', 'Datos_SIATA_Aire_pm25.json'),

  /** Build del frontend que sirve el propio Express en producción. */
  distDir: path.join(ROOT, 'frontend', 'dist'),

  /** Cada cuánto se revisa si el ETL publicó artefactos nuevos (ms). */
  reloadIntervalMs: num(process.env.RELOAD_INTERVAL_MS, 15_000),

  /** Método de interpolación por defecto de /api/air. */
  defaultMethod: process.env.DEFAULT_METHOD || 'linear',

  /**
   * Modo «tiempo real» simulado: interpola sobre la marcha desde el histórico,
   * sin malla precalculada. Es el banco de pruebas del camino de streaming.
   */
  replay: {
    enabled: bool(process.env.REPLAY_ENABLED, true),
    /** Hora que se hace pasar por «ahora». Vacío = la última del archivo. */
    at: process.env.REPLAY_AT || null,
    windowHours: num(process.env.REPLAY_WINDOW_HOURS, 24),
    /** Exponente de la ponderación por distancia inversa. */
    idwPower: num(process.env.IDW_POWER, 2),
    /** Vecinas consideradas en cada consulta. */
    neighbors: num(process.env.IDW_NEIGHBORS, 6),
  },

  /** Límite de coordenadas aceptadas (Valle de Aburrá con margen). */
  bounds: { latMin: 5.9, latMax: 6.7, lonMin: -75.9, lonMax: -75.1 },
};
