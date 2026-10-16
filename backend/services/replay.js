/**
 * Modo «tiempo real» simulado.
 *
 * Reproduce el histórico del SIATA como si el dato estuviera llegando ahora e
 * interpola **sobre la marcha**, sin malla precalculada. Existe por dos razones:
 *
 * 1. Deja montado y probado el camino que usará el streaming real: cuando el
 *    adaptador `LiveSiataSource` esté implementado, solo cambia de dónde salen
 *    los valores de `snapshot()`; el resto de la ruta ya funciona.
 * 2. Permite usar la PWA antes de haber corrido el ETL en Python.
 *
 * Limitación deliberada: en vivo solo hay `nearest` e `idw`. `linear` y `cubic`
 * necesitan triangulación de Delaunay y viven en el ETL (SciPy), que es donde
 * además se hace la limpieza y la imputación serias. El filtro de aquí es solo
 * de cordura, no sustituye al control de calidad de `etl/clean.py`.
 */
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { haversine } from './geo.js';

const HORA_MS = 3_600_000;
const MIN_HORAS_24H = 18; // mismas reglas de cobertura que el ETL

/** @type {null | Promise<object>} */
let cargando = null;

/** Filtro de cordura: centinelas, negativos, saturaciones y banderas del SIATA. */
function esValido(punto) {
  const v = punto.valor;
  const calidad = Number(punto.calidad);
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= 0 &&
    v <= 1000 &&
    (Number.isNaN(calidad) || calidad === 1)
  );
}

async function cargar() {
  const t0 = Date.now();
  const crudo = JSON.parse(await fs.readFile(config.rawFile, 'utf8'));

  const estaciones = crudo.map((st) => ({
    codigo_serial: Number(st.codigoSerial),
    nombre: String(st.nombre ?? '').trim(),
    nombre_corto: String(st.nombreCorto ?? '').trim(),
    latitud: Number(st.latitud),
    longitud: Number(st.longitud),
  }));

  // Rejilla horaria común a todas las estaciones.
  let tMin = Infinity;
  let tMax = -Infinity;
  const porEstacion = crudo.map((st) =>
    st.datos.map((punto) => {
      const t = Date.parse(`${punto.fecha.replace(' ', 'T')}Z`);
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      return { t, v: esValido(punto) ? punto.valor : Number.NaN };
    }),
  );

  const nHoras = Math.round((tMax - tMin) / HORA_MS) + 1;
  const series = porEstacion.map((puntos) => {
    const arr = new Float64Array(nHoras).fill(Number.NaN);
    for (const { t, v } of puntos) arr[Math.round((t - tMin) / HORA_MS)] = v;
    return arr;
  });

  console.log(
    `[replay] ${estaciones.length} estaciones x ${nHoras} horas cargadas en ${Date.now() - t0} ms`,
  );
  return { estaciones, series, tMin, tMax, nHoras };
}

function datos() {
  cargando ??= cargar().catch((error) => {
    cargando = null;
    throw new Error(`No se pudo cargar el archivo crudo (${config.rawFile}): ${error.message}`);
  });
  return cargando;
}

/** Índice horario correspondiente al instante que se hace pasar por «ahora». */
function indiceActual(store) {
  if (config.replay.at) {
    const t = Date.parse(`${config.replay.at.replace(' ', 'T')}Z`);
    if (Number.isFinite(t)) {
      return Math.max(0, Math.min(store.nHoras - 1, Math.round((t - store.tMin) / HORA_MS)));
    }
  }
  return store.nHoras - 1;
}

/**
 * Corte transversal de la red en el instante simulado: valor horario y media
 * móvil de 24 h por estación.
 */
export async function snapshot() {
  const store = await datos();
  const idx = indiceActual(store);
  const desde = Math.max(0, idx - 23);

  const estaciones = store.estaciones.map((est, s) => {
    const serie = store.series[s];
    let suma = 0;
    let n = 0;
    for (let i = desde; i <= idx; i += 1) {
      const v = serie[i];
      if (Number.isFinite(v)) {
        suma += v;
        n += 1;
      }
    }
    const v1h = Number.isFinite(serie[idx]) ? serie[idx] : null;
    return {
      ...est,
      pm25_1h: v1h === null ? null : Math.round(v1h * 100) / 100,
      pm25_24h: n >= MIN_HORAS_24H ? Math.round((suma / n) * 100) / 100 : null,
      horas_observadas_24h: n,
      origen_dato: 'observado',
    };
  });

  return {
    modo: 'replay',
    fecha: new Date(store.tMin + idx * HORA_MS).toISOString().replace('T', ' ').slice(0, 19),
    ventana_horas: config.replay.windowHours,
    estaciones,
  };
}

/**
 * Interpolación en línea sobre el corte actual.
 * @param {number} lat
 * @param {number} lon
 * @param {'idw'|'nearest'} metodo
 * @param {'pm25_24h'|'pm25_1h'} campo
 */
export async function estimar(lat, lon, metodo = 'idw', campo = 'pm25_24h') {
  const corte = await snapshot();
  const conDato = corte.estaciones
    .filter((est) => est[campo] !== null)
    .map((est) => ({ ...est, distancia_km: haversine(lat, lon, est.latitud, est.longitud) }))
    .sort((a, b) => a.distancia_km - b.distancia_km);

  if (conDato.length === 0) {
    return { valor: null, metodo, fecha: corte.fecha, aporte: [], estaciones: corte.estaciones };
  }

  if (metodo === 'nearest') {
    const mas = conDato[0];
    return {
      valor: mas[campo],
      metodo: 'nearest',
      fecha: corte.fecha,
      aporte: [{ nombre_corto: mas.nombre_corto, distancia_km: redondear(mas.distancia_km), peso: 1, valor: mas[campo] }],
      estaciones: corte.estaciones,
    };
  }

  const vecinas = conDato.slice(0, config.replay.neighbors);
  const p = config.replay.idwPower;
  let num = 0;
  let den = 0;
  const aporte = [];
  for (const est of vecinas) {
    // A menos de 50 m se considera que el usuario está en la estación.
    if (est.distancia_km < 0.05) {
      return {
        valor: est[campo],
        metodo: 'idw',
        fecha: corte.fecha,
        aporte: [{ nombre_corto: est.nombre_corto, distancia_km: redondear(est.distancia_km), peso: 1, valor: est[campo] }],
        estaciones: corte.estaciones,
      };
    }
    const peso = 1 / est.distancia_km ** p;
    num += peso * est[campo];
    den += peso;
    aporte.push({ nombre_corto: est.nombre_corto, distancia_km: redondear(est.distancia_km), peso, valor: est[campo] });
  }

  for (const a of aporte) a.peso = Math.round((a.peso / den) * 1000) / 1000;
  return {
    valor: Math.round((num / den) * 100) / 100,
    metodo: 'idw',
    fecha: corte.fecha,
    aporte,
    estaciones: corte.estaciones,
  };
}

const redondear = (x) => Math.round(x * 1000) / 1000;

/** ¿Está disponible el modo simulado? (archivo crudo presente y flag activo) */
export async function disponible() {
  if (!config.replay.enabled) return false;
  try {
    await fs.access(config.rawFile);
    return true;
  } catch {
    return false;
  }
}
