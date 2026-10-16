/**
 * Rutas de observabilidad del ETL: alimentan la vista «Proceso ETL».
 *
 * Todo lo que se expone aquí lo escribió el pipeline de Python; el backend no
 * recalcula nada. Cuando el ETL pase a correr contra datos en vivo cada N
 * minutos, estas mismas rutas mostrarán el historial de ejecuciones.
 */
import { Router } from 'express';
import { get, status, notReadyPayload } from '../services/artifacts.js';
import { field } from '../services/grid.js';

export const router = Router();

router.get('/etl/status', async (_req, res, next) => {
  try {
    res.json(await status());
  } catch (error) {
    next(error);
  }
});

/** Reporte completo: etapas, calidad, imputación, validación cruzada. */
router.get('/etl/report', async (_req, res, next) => {
  try {
    const reporte = await get('report');
    if (!reporte) return res.status(503).json(notReadyPayload());
    res.json(reporte);
  } catch (error) {
    next(error);
  }
});

/**
 * Analítica descriptiva del histórico: auditoría, semáforo por estación,
 * perfil horario, mapa de calor y validación de la imputación. Es lo que
 * alimenta las gráficas de la vista «Análisis».
 */
router.get('/etl/analytics', async (_req, res, next) => {
  try {
    const analitica = await get('analytics');
    if (!analitica) return res.status(503).json(notReadyPayload());
    res.json(analitica);
  } catch (error) {
    next(error);
  }
});

/** Historial de las últimas ejecuciones (útil cuando el ETL sea periódico). */
router.get('/etl/runs', async (_req, res, next) => {
  try {
    res.json({ ejecuciones: (await get('runs')) ?? [] });
  } catch (error) {
    next(error);
  }
});

/**
 * Campo interpolado listo para pintar.
 * `?campo=pm25_24h&metodo=linear&max=2500` — `max` submuestrea la malla.
 */
router.get('/etl/grid', async (req, res, next) => {
  try {
    const grid = await get('grid');
    if (!grid) return res.status(503).json(notReadyPayload());

    const campo = ['pm25_24h', 'pm25_1h'].includes(req.query.campo) ? req.query.campo : 'pm25_24h';
    const metodo = (grid.metodos ?? []).includes(req.query.metodo) ? req.query.metodo : (grid.metodos?.[0] ?? 'linear');
    const max = Number(req.query.max);

    res.json({
      snapshot: grid.snapshot,
      generado_en: grid.generado_en,
      metodos: grid.metodos,
      ...field(grid, campo, metodo, { maxCells: Number.isFinite(max) ? max : 0 }),
    });
  } catch (error) {
    next(error);
  }
});
