/** Utilidades geográficas compartidas por el backend. */
import { config } from '../config.js';

const R_KM = 6371.0088;
const rad = (deg) => (deg * Math.PI) / 180;

/** Distancia en kilómetros sobre la superficie terrestre. */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Estaciones ordenadas por cercanía al punto, con la distancia calculada. */
export function byDistance(estaciones, lat, lon) {
  return estaciones
    .map((est) => ({ ...est, distancia_km: Math.round(haversine(lat, lon, est.latitud, est.longitud) * 1000) / 1000 }))
    .sort((a, b) => a.distancia_km - b.distancia_km);
}

/**
 * Valida y normaliza las coordenadas que llegan por query string.
 * @returns {{ok: true, lat: number, lon: number} | {ok: false, error: string}}
 */
export function parseCoords(query) {
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, error: 'Parámetros lat y lon obligatorios y numéricos.' };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, error: 'Coordenadas fuera del rango geográfico válido.' };
  }
  const { latMin, latMax, lonMin, lonMax } = config.bounds;
  const dentro = lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
  return { ok: true, lat, lon, dentroDelValle: dentro };
}
