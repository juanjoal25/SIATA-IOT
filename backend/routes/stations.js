/** `GET /api/stations` — red de estaciones con su última lectura y su ICA. */
import { Router } from 'express';
import { get, isReady } from '../services/artifacts.js';
import { byDistance } from '../services/geo.js';
import { clasificar, escala } from '../services/ica.js';
import * as replay from '../services/replay.js';

export const router = Router();

router.get('/stations', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const ordenar = Number.isFinite(lat) && Number.isFinite(lon);

    let payload;
    if (await isReady()) {
      const artefacto = await get('stations');
      payload = { fuente: 'malla-etl', snapshot: artefacto.snapshot, estaciones: artefacto.estaciones };
    } else if (await replay.disponible()) {
      const corte = await replay.snapshot();
      const estaciones = [];
      for (const est of corte.estaciones) {
        estaciones.push({ ...est, ...(await clasificar(est.pm25_24h)) });
      }
      payload = { fuente: 'tiempo-real', snapshot: corte.fecha, estaciones };
    } else {
      return res.status(503).json({ error: 'sin_datos', mensaje: 'No hay artefactos del ETL ni archivo crudo disponible.' });
    }

    if (ordenar) payload.estaciones = byDistance(payload.estaciones, lat, lon);
    res.json({ ...payload, total: payload.estaciones.length });
  } catch (error) {
    next(error);
  }
});

/** `GET /api/ica/escala` — tabla del semáforo (la usa la leyenda del frontend). */
router.get('/ica/escala', async (_req, res, next) => {
  try {
    res.json({ escala: await escala() });
  } catch (error) {
    next(error);
  }
});
