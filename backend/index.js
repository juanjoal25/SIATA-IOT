/**
 * API del monolito: sirve los artefactos del ETL y, en producción, el build
 * de la PWA. No hace ciencia de datos — eso vive en `etl/` (Python).
 *
 *   npm run dev:api     solo la API, con recarga
 *   npm run dev         solo el frontend (Vite, proxy a esta API)
 *   npm run dev:full    ambos
 *   npm start           producción: Express sirve la API y frontend/dist
 */
import express from 'express';
import fs from 'node:fs';
import { config } from './config.js';
import { refresh, status, get } from './services/artifacts.js';
import * as replay from './services/replay.js';
import { router as airRouter } from './routes/air.js';
import { router as stationsRouter } from './routes/stations.js';
import { router as etlRouter } from './routes/etl.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// En desarrollo el frontend corre en otro puerto; el proxy de Vite cubre el
// caso normal, pero dejamos CORS abierto para probar desde el móvil en la LAN.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    servicio: 'siata-aire-api',
    hora: new Date().toISOString(),
    etl: await status(),
    tiempo_real_simulado: await replay.disponible(),
  });
});

app.get('/api/meta', async (_req, res) => {
  const meta = await get('meta');
  res.json({
    etl: meta,
    estado: await status(),
    metodo_por_defecto: config.defaultMethod,
    tiempo_real_simulado: await replay.disponible(),
    modo_tiempo_real: config.replay,
  });
});

app.use('/api', airRouter);
app.use('/api', stationsRouter);
app.use('/api', etlRouter);

// --------------------------------------------------------------- producción
if (fs.existsSync(config.distDir)) {
  app.use(express.static(config.distDir, { index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile('index.html', { root: config.distDir }));
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'ruta_no_encontrada' }));

app.use((error, _req, res, _next) => {
  console.error('[api]', error);
  res.status(500).json({ error: 'error_interno', mensaje: error.message });
});

const server = app.listen(config.port, config.host, async () => {
  await refresh({ force: true });
  const estado = await status();
  console.log(`\n  API      http://${config.host}:${config.port}/api`);
  console.log(`  ETL      ${estado.listo ? `artefactos de ${estado.snapshot}` : 'sin artefactos todavía'}`);
  if (!estado.listo) {
    console.log('           ejecuta `python -m etl.run` para generar la malla interpolada');
    if (await replay.disponible()) {
      console.log('           mientras tanto: modo tiempo real simulado (IDW en línea) activo');
    }
  }
  if (fs.existsSync(config.distDir)) console.log(`  Web      http://${config.host}:${config.port}/`);
  console.log('');
});

for (const señal of ['SIGINT', 'SIGTERM']) {
  process.on(señal, () => server.close(() => process.exit(0)));
}
