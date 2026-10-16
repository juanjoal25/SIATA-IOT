/**
 * `GET /api/air` — diagnóstico de calidad del aire en un punto.
 *
 * Es la ruta que consume el botón «Analizar calidad del aire en mi ubicación».
 * Cruza la coordenada del GPS con la malla interpolada del ETL y devuelve el
 * semáforo del ICA, la comparación entre los tres métodos de interpolación y
 * la estación real más cercana para que el resultado sea auditable.
 *
 * Si el ETL todavía no ha publicado la malla, cae al modo de tiempo real
 * simulado (`replay`), que interpola en línea con IDW.
 */
import { Router } from 'express';
import { config } from '../config.js';
import { get, isReady, notReadyPayload } from '../services/artifacts.js';
import { parseCoords, byDistance } from '../services/geo.js';
import { sample } from '../services/grid.js';
import { clasificar } from '../services/ica.js';
import * as replay from '../services/replay.js';

export const router = Router();

const CAMPOS = new Set(['pm25_24h', 'pm25_1h']);

router.get('/air', async (req, res, next) => {
  try {
    const coords = parseCoords(req.query);
    if (!coords.ok) return res.status(400).json({ error: 'coordenadas_invalidas', mensaje: coords.error });

    const campo = CAMPOS.has(req.query.campo) ? req.query.campo : 'pm25_24h';
    const metodoPedido = req.query.metodo || config.defaultMethod;
    const advertencias = [];
    if (!coords.dentroDelValle) {
      advertencias.push(
        'Tu ubicación está fuera del Valle de Aburrá. El resultado es una extrapolación y no debe usarse como diagnóstico.',
      );
    }

    if (await isReady()) {
      return res.json(await desdeMalla({ coords, campo, metodoPedido, advertencias }));
    }
    if (await replay.disponible()) {
      advertencias.push(
        'El ETL no ha publicado la malla todavía: se está estimando en línea con IDW sobre el histórico (modo tiempo real simulado).',
      );
      return res.json(await desdeTiempoReal({ coords, campo, metodoPedido, advertencias }));
    }
    return res.status(503).json(notReadyPayload());
  } catch (error) {
    next(error);
  }
});

async function desdeMalla({ coords, campo, metodoPedido, advertencias }) {
  const grid = await get('grid');
  const stations = await get('stations');
  const metodos = grid.metodos ?? ['linear'];
  const metodo = metodos.includes(metodoPedido) ? metodoPedido : metodos[0];
  if (metodo !== metodoPedido) {
    advertencias.push(`El método "${metodoPedido}" no está en la malla publicada; se usó "${metodo}".`);
  }

  const principal = sample(grid, campo, metodo, coords.lat, coords.lon);
  if (principal.fuera_de_malla) {
    advertencias.push('El punto queda fuera de la malla calculada por el ETL.');
  }
  if (principal.extrapolado) {
    advertencias.push(
      'El punto está fuera del casco convexo de las estaciones: el valor proviene del vecino más cercano.',
    );
  }

  const comparacion = {};
  for (const m of metodos) {
    const punto = sample(grid, campo, m, coords.lat, coords.lon);
    comparacion[m] = { pm25: punto.valor, ...(await clasificar(punto.valor)), extrapolado: punto.extrapolado };
  }

  const cercanas = byDistance(stations?.estaciones ?? [], coords.lat, coords.lon);
  const horaria = sample(grid, 'pm25_1h', metodo, coords.lat, coords.lon);

  return {
    ubicacion: { latitud: coords.lat, longitud: coords.lon, dentro_del_valle: coords.dentroDelValle },
    fuente: 'malla-etl',
    snapshot: grid.snapshot,
    generado_en: grid.generado_en,
    campo,
    metodo,
    metodos_disponibles: metodos,
    diagnostico: await clasificar(principal.valor),
    pm25_1h: horaria.valor,
    comparacion,
    celda: principal.celda,
    extrapolado: principal.extrapolado,
    estacion_mas_cercana: cercanas[0] ?? null,
    estaciones_cercanas: cercanas.slice(0, 3),
    advertencias,
  };
}

async function desdeTiempoReal({ coords, campo, metodoPedido, advertencias }) {
  const metodo = metodoPedido === 'nearest' ? 'nearest' : 'idw';
  if (!['idw', 'nearest'].includes(metodoPedido)) {
    advertencias.push(
      `En tiempo real solo hay "idw" y "nearest" (linear y cubic requieren la malla del ETL); se usó "${metodo}".`,
    );
  }
  const idw = await replay.estimar(coords.lat, coords.lon, 'idw', campo);
  const nearest = await replay.estimar(coords.lat, coords.lon, 'nearest', campo);
  const elegido = metodo === 'nearest' ? nearest : idw;

  // El corte en vivo trae solo concentraciones; el semáforo se calcula aquí
  // (en el camino de la malla ya viene resuelto desde el artefacto del ETL).
  const cercanas = [];
  for (const est of byDistance(idw.estaciones, coords.lat, coords.lon).slice(0, 3)) {
    cercanas.push({ ...est, ...(await clasificar(est.pm25_24h)) });
  }

  return {
    ubicacion: { latitud: coords.lat, longitud: coords.lon, dentro_del_valle: coords.dentroDelValle },
    fuente: 'tiempo-real',
    snapshot: elegido.fecha,
    generado_en: new Date().toISOString(),
    campo,
    metodo,
    metodos_disponibles: ['idw', 'nearest'],
    diagnostico: await clasificar(elegido.valor),
    pm25_1h: (await replay.estimar(coords.lat, coords.lon, metodo, 'pm25_1h')).valor,
    comparacion: {
      idw: { pm25: idw.valor, ...(await clasificar(idw.valor)), extrapolado: false },
      nearest: { pm25: nearest.valor, ...(await clasificar(nearest.valor)), extrapolado: false },
    },
    aporte_estaciones: elegido.aporte,
    extrapolado: false,
    estacion_mas_cercana: cercanas[0] ?? null,
    estaciones_cercanas: cercanas,
    advertencias,
  };
}
