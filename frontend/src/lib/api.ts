/**
 * Cliente de la API. Rutas relativas a propósito: en desarrollo las resuelve el
 * proxy de Vite y en producción las sirve el mismo Express, así que la PWA
 * funciona igual instalada que en el navegador.
 */
import type {
  Analitica,
  CampoMalla,
  EstadoEtl,
  Estacion,
  ReporteEtl,
  RespuestaAire,
  TramoEscala,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, { headers: { Accept: 'application/json' }, ...init });
  } catch {
    throw new ApiError('No hay conexión con el servidor. Revisa que la API esté corriendo.', 0, 'sin_red');
  }
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new ApiError(
      (cuerpo?.mensaje as string) ?? `La API respondió ${respuesta.status}.`,
      respuesta.status,
      cuerpo?.error as string | undefined,
    );
  }
  return cuerpo as T;
}

/** Diagnóstico en un punto: es la llamada del botón principal. */
export const analizarPunto = (lat: number, lon: number, metodo?: string) =>
  pedir<RespuestaAire>(
    `/api/air?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}${metodo ? `&metodo=${metodo}` : ''}`,
  );

export const obtenerEstaciones = (lat?: number, lon?: number) =>
  pedir<{ fuente: string; snapshot: string; estaciones: Estacion[]; total: number }>(
    lat !== undefined && lon !== undefined
      ? `/api/stations?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`
      : '/api/stations',
  );

export const obtenerEscala = () => pedir<{ escala: TramoEscala[] }>('/api/ica/escala');

export const obtenerEstadoEtl = () => pedir<EstadoEtl>('/api/etl/status');

export const obtenerReporteEtl = () => pedir<ReporteEtl>('/api/etl/report');

/** Analítica descriptiva del histórico: la materia prima de la vista «Análisis». */
export const obtenerAnalitica = () => pedir<Analitica>('/api/etl/analytics');

export const obtenerEjecuciones = () =>
  pedir<{ ejecuciones: Record<string, unknown>[] }>('/api/etl/runs');

// 9000 celdas cubren la malla por defecto (91x89) sin submuestrear: son ~60 KB,
// asumibles, y el mapa se ve a su resolución real.
export const obtenerMalla = (metodo: string, campo = 'pm25_24h', max = 9000) =>
  pedir<CampoMalla>(`/api/etl/grid?metodo=${metodo}&campo=${campo}&max=${max}`);
