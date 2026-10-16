import { useEffect, useState } from 'react';
import {
  ApiError,
  obtenerEjecuciones,
  obtenerEscala,
  obtenerEstadoEtl,
  obtenerMalla,
  obtenerReporteEtl,
} from '../lib/api';
import type { CampoMalla, EstadoEtl, ReporteEtl, TramoEscala } from '../lib/types';
import { MapaMalla } from '../components/MapaMalla';

/**
 * Vista de observabilidad del pipeline: qué entró, qué se descartó, qué se
 * imputó y qué tan bien interpola cada método. Es la trazabilidad del número
 * que la app le muestra al usuario.
 */
export function ProcesoEtl() {
  const [estado, setEstado] = useState<EstadoEtl | null>(null);
  const [reporte, setReporte] = useState<ReporteEtl | null>(null);
  const [escala, setEscala] = useState<TramoEscala[]>([]);
  const [malla, setMalla] = useState<CampoMalla | null>(null);
  const [metodoMapa, setMetodoMapa] = useState('linear');
  const [ejecuciones, setEjecuciones] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [est, esc] = await Promise.all([obtenerEstadoEtl(), obtenerEscala()]);
        if (!vivo) return;
        setEstado(est);
        setEscala(esc.escala);
        if (est.listo) {
          const [rep, runs] = await Promise.all([obtenerReporteEtl(), obtenerEjecuciones()]);
          if (!vivo) return;
          setReporte(rep);
          setEjecuciones(runs.ejecuciones);
          setMetodoMapa(rep.interpolacion.metodo_por_defecto ?? 'linear');
        }
      } catch (fallo) {
        if (vivo) setError(fallo instanceof ApiError ? fallo.message : 'No se pudo cargar el reporte del ETL.');
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!estado?.listo) return;
    let vivo = true;
    obtenerMalla(metodoMapa)
      .then((campo) => vivo && setMalla(campo))
      .catch(() => vivo && setMalla(null));
    return () => {
      vivo = false;
    };
  }, [estado?.listo, metodoMapa]);

  if (cargando) {
    return (
      <section className="tarjeta">
        <h2>Proceso ETL</h2>
        <div className="leyenda">
          {[80, 60, 70, 50].map((ancho) => (
            <div key={ancho} className="esqueleto" style={{ width: `${ancho}%` }} />
          ))}
        </div>
      </section>
    );
  }

  if (!estado?.listo) {
    return (
      <>
        <section className="tarjeta">
          <h2>Proceso ETL</h2>
          <div className="aviso alerta">
            <span aria-hidden>⚠</span>
            <span>
              El pipeline todavía no ha publicado artefactos. Ejecuta <code>python -m etl.run</code> en la
              raíz del proyecto para generar la malla interpolada y el reporte.
            </span>
          </div>
          <p className="nota">Carpeta vigilada: {estado?.carpeta}</p>
          {estado?.faltantes?.length ? <p className="nota">Faltan: {estado.faltantes.join(', ')}</p> : null}
        </section>
        {error && <div className="aviso error">{error}</div>}
      </>
    );
  }

  if (!reporte) {
    return <div className="aviso error">{error ?? 'No hay reporte disponible.'}</div>;
  }

  const { calidad, imputacion, interpolacion } = reporte;
  const cv = interpolacion.validacion_cruzada;

  return (
    <>
      <section className="tarjeta">
        <h2>Resumen de la corrida</h2>
        <div className="kpis">
          <Kpi etiqueta="Snapshot" cifra={interpolacion.snapshot.fecha.slice(0, 16)} pie={`fuente: ${reporte.fuente.source}`} />
          <Kpi etiqueta="Cobertura cruda" cifra={pct(calidad.cobertura_global)} pie={`${fmt(calidad.celdas_descartadas)} celdas descartadas`} />
          <Kpi etiqueta="Completitud final" cifra={pct(imputacion.completitud_final)} pie={`${fmt(total(imputacion.imputados))} valores imputados`} />
          <Kpi etiqueta="Mejor método" cifra={cv.mejor_metodo ?? '—'} pie={`MAE ${num(cv.metodos[cv.mejor_metodo ?? '']?.mae)} µg/m³`} />
          <Kpi etiqueta="Duración" cifra={`${reporte.duracion_total_s.toFixed(1)} s`} pie={`${reporte.etapas.length} etapas`} />
          <Kpi etiqueta="Rango histórico" cifra={`${calidad.horas} h`} pie={`${calidad.estaciones} estaciones`} />
        </div>
        <p className="nota">
          Generado el {new Date(reporte.generado_en).toLocaleString('es-CO')} · versión {reporte.version}
          {reporte.fuente.realtime && ' · fuente en tiempo real'}
        </p>
      </section>

      <section className="tarjeta">
        <h2>Etapas del pipeline</h2>
        <div className="etapas">
          {reporte.etapas.map((etapa) => (
            <article className="etapa" key={etapa.orden}>
              <div className="indice">{etapa.orden}</div>
              <div>
                <div className="titulo">
                  <strong>{etapa.nombre}</strong>
                  <span className="duracion">{etapa.duracion_s.toFixed(2)} s</span>
                </div>
                <p className="descripcion">{etapa.descripcion}</p>
                <div className="metricas">
                  {Object.entries(etapa.metricas).map(([clave, valor]) => (
                    <span className="metrica" key={clave}>
                      {clave.replace(/_/g, ' ')} <b>{formatoMetrica(clave, valor)}</b>
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="tarjeta">
        <h2>Calidad de datos</h2>
        <p>
          De {fmt(calidad.celdas_totales)} celdas (estación × hora), {fmt(calidad.celdas_validas)} pasaron
          todos los filtros. Cada descarte queda con su motivo.
        </p>
        <BarraDescartes descartes={calidad.descartes} total={calidad.celdas_totales} />
        <div className="tabla-contenedor">
          <table>
            <thead>
              <tr>
                <th>Estación</th>
                <th className="num">Cobertura</th>
                <th className="num">Centinela</th>
                <th className="num">Negativo</th>
                <th className="num">Cero sensor</th>
                <th className="num">Fuera rango</th>
                <th className="num">Bandera</th>
                <th className="num">Atíp. local</th>
                <th className="num">Atíp. espacial</th>
                <th className="num">Hueco máx.</th>
              </tr>
            </thead>
            <tbody>
              {calidad.por_estacion.map((fila) => (
                <tr key={String(fila.codigo_serial)}>
                  <td>{nombreEstacion(reporte, fila.codigo_serial as number)}</td>
                  <td className="num">{pct(fila.cobertura as number)}</td>
                  <td className="num">{fmt(fila.centinela as number)}</td>
                  <td className="num">{fmt(fila.negativo as number)}</td>
                  <td className="num">{fmt(fila.cero_sensor as number)}</td>
                  <td className="num">{fmt(fila.fuera_rango as number)}</td>
                  <td className="num">{fmt(fila.bandera_calidad as number)}</td>
                  <td className="num">{fmt(fila.atipico_local as number)}</td>
                  <td className="num">{fmt(fila.atipico_espacial as number)}</td>
                  <td className="num">{fmt(fila.hueco_max_horas as number)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta">
        <h2>Imputación</h2>
        <p>
          Cascada de tres estrategias: temporal para huecos de hasta{' '}
          {imputacion.parametros.hueco_max_temporal_h} h, espacial escalada con{' '}
          {imputacion.parametros.vecinos} vecinas hasta {imputacion.parametros.hueco_max_espacial_h} h, y
          climatología mes × hora para el resto.
        </p>
        <div className="kpis">
          <Kpi etiqueta="Faltantes de entrada" cifra={fmt(imputacion.faltantes_entrada)} pie="tras la limpieza" />
          {Object.entries(imputacion.imputados).map(([metodo, valor]) => (
            <Kpi key={metodo} etiqueta={metodo} cifra={fmt(valor)} pie="valores rellenados" />
          ))}
          <Kpi etiqueta="Sin dato" cifra={fmt(imputacion.sin_dato_restante)} pie="no fue posible imputar" />
        </div>
      </section>

      <section className="tarjeta">
        <h2>Interpolación espacial</h2>
        {interpolacion.excluidas?.length > 0 && (
          <div className="aviso info">
            <span aria-hidden>i</span>
            <span>
              La superficie se construye con <strong>{interpolacion.nodos}</strong> de{' '}
              {calidad.estaciones} estaciones. Quedan fuera{' '}
              <strong>{interpolacion.excluidas.map((e) => e.nombre_corto).join(' y ')}</strong>:{' '}
              {interpolacion.nota_exclusion}
            </span>
          </div>
        )}
        <p>
          Validación cruzada dejando una estación fuera: se esconde cada estación, se interpola en su
          coordenada con las {interpolacion.nodos - 1} restantes y se compara con lo que midió.
        </p>
        <div className="tabla-contenedor">
          <table style={{ minWidth: 380 }}>
            <thead>
              <tr>
                <th>Método</th>
                <th className="num">Estaciones</th>
                <th className="num">MAE*</th>
                <th className="num">MAE</th>
                <th className="num">RMSE</th>
                <th className="num">Sesgo</th>
                <th className="num">R²</th>
                <th className="num">Error máx.</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(cv.metodos).map(([metodo, m]) => (
                <tr key={metodo} className={metodo === cv.mejor_metodo ? 'destacada' : undefined}>
                  <td>
                    {metodo}
                    {metodo === cv.mejor_metodo && ' ★'}
                  </td>
                  <td className="num">{m.n}</td>
                  <td className="num">{num(m.mae_comun)}</td>
                  <td className="num">{num(m.mae)}</td>
                  <td className="num">{num(m.rmse)}</td>
                  <td className="num">{num(m.sesgo)}</td>
                  <td className="num">{num(m.r2)}</td>
                  <td className="num">{num(m.error_max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="nota">
          Errores en µg/m³ sobre el promedio de 24 h. Al esconder una estación del casco convexo,
          `linear` y `cubic` no pueden predecirla y `nearest` sí, por lo que cada método evalúa una
          muestra distinta: <strong>MAE*</strong> es el error sobre las {cv.n_comun} estaciones que
          los tres cubren, y es el criterio que elige el ★.
        </p>
        {cv.metodos[cv.mejor_metodo ?? '']?.r2 !== null &&
          (cv.metodos[cv.mejor_metodo ?? '']?.r2 ?? 0) < 0 && (
            <div className="aviso alerta">
              <span aria-hidden>⚠</span>
              <span>
                El R² es negativo para todos los métodos: en esta hora el campo es casi plano salvo
                las estaciones de tráfico, que responden a un microentorno local y ninguna
                interpolación espacial puede predecirlas desde sus vecinas. El valor interpolado es
                razonable como referencia de fondo, no como medición puntual.
              </span>
            </div>
          )}

        <h2 style={{ marginTop: 22 }}>Campo interpolado</h2>
        <div className="selector">
          {interpolacion.metodos.map((metodo) => (
            <button
              key={metodo}
              type="button"
              aria-pressed={metodo === metodoMapa}
              onClick={() => setMetodoMapa(metodo)}
            >
              {metodo}
            </button>
          ))}
        </div>
        {malla ? (
          <MapaMalla campo={malla} escala={escala} estaciones={reporte.estaciones} />
        ) : (
          <div className="esqueleto" style={{ height: 240 }} />
        )}
      </section>

      {ejecuciones.length > 0 && (
        <section className="tarjeta">
          <h2>Historial de ejecuciones</h2>
          <p>
            Cada corrida del ETL deja una fila. Cuando el pipeline pase a datos en vivo (cron cada N
            minutos con <code>--source live</code>), este historial es el que permite vigilarlo.
          </p>
          <div className="tabla-contenedor">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Fuente</th>
                  <th className="num">Duración</th>
                  <th className="num">Cobertura</th>
                  <th className="num">Completitud</th>
                  <th>Snapshot</th>
                  <th>Mejor método</th>
                </tr>
              </thead>
              <tbody>
                {[...ejecuciones].reverse().map((run, i) => (
                  <tr key={`${String(run.generado_en)}-${i}`}>
                    <td>{new Date(String(run.generado_en)).toLocaleString('es-CO')}</td>
                    <td>
                      {String(run.fuente)}
                      {run.tiempo_real ? ' (vivo)' : ''}
                    </td>
                    <td className="num">{Number(run.duracion_s).toFixed(1)} s</td>
                    <td className="num">{pct(Number(run.cobertura_global))}</td>
                    <td className="num">{pct(Number(run.completitud_final))}</td>
                    <td>{String(run.snapshot ?? '—').slice(0, 16)}</td>
                    <td>{String(run.mejor_metodo ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {reporte.avisos.length > 0 && (
        <section className="tarjeta">
          <h2>Avisos del pipeline</h2>
          {reporte.avisos.map((aviso) => (
            <div className="aviso alerta" key={aviso}>
              <span aria-hidden>⚠</span>
              <span>{aviso}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Kpi({ etiqueta, cifra, pie }: { etiqueta: string; cifra: string; pie?: string }) {
  return (
    <div className="kpi">
      <div className="etiqueta">{etiqueta}</div>
      <div className="cifra">{cifra}</div>
      {pie && <div className="pie">{pie}</div>}
    </div>
  );
}

const COLORES_DESCARTE: Record<string, string> = {
  ausente: '#4b5563',
  centinela: '#8f3f97',
  negativo: '#ff7e00',
  cero_sensor: '#7aa2ff',
  fuera_rango: '#ff0000',
  bandera_calidad: '#ffff00',
  atipico_local: '#5b8cff',
  atipico_espacial: '#00e400',
};

function BarraDescartes({ descartes, total }: { descartes: Record<string, number>; total: number }) {
  const entradas = Object.entries(descartes).filter(([, v]) => v > 0);
  const descartado = entradas.reduce((acc, [, v]) => acc + v, 0);
  return (
    <>
      <div className="barra-descartes">
        <span style={{ width: `${((total - descartado) / total) * 100}%`, background: '#1f7a4c' }} />
        {entradas.map(([clave, valor]) => (
          <span
            key={clave}
            style={{ width: `${(valor / total) * 100}%`, background: COLORES_DESCARTE[clave] ?? '#888' }}
            title={`${clave}: ${valor}`}
          />
        ))}
      </div>
      <div className="leyenda" style={{ marginBottom: 14 }}>
        {entradas.map(([clave, valor]) => (
          <div className="leyenda-fila" key={clave}>
            <span className="muestra" style={{ background: COLORES_DESCARTE[clave] ?? '#888' }} />
            <span>{clave.replace(/_/g, ' ')}</span>
            <span className="rango">
              {fmt(valor)} · {((valor / total) * 100).toFixed(2)} %
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

const fmt = (n: number | undefined | null) =>
  n === undefined || n === null || Number.isNaN(n) ? '—' : n.toLocaleString('es-CO');
const pct = (n: number | undefined | null) =>
  n === undefined || n === null || Number.isNaN(n) ? '—' : `${(n * 100).toFixed(2)} %`;
const num = (n: number | undefined | null) =>
  n === undefined || n === null || Number.isNaN(n) ? '—' : n.toFixed(2);
const total = (registro: Record<string, number>) => Object.values(registro).reduce((a, b) => a + b, 0);

/** Las métricas de cada etapa son heterogéneas: conteos, razones, listas y fechas. */
function formatoMetrica(clave: string, valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  if (Array.isArray(valor)) return valor.join(', ');
  if (typeof valor === 'number') {
    if (/^(cobertura|completitud)/.test(clave)) return pct(valor);
    return Number.isInteger(valor) ? fmt(valor) : valor.toFixed(3);
  }
  const texto = String(valor);
  return texto.length > 22 ? `${texto.slice(0, 22)}…` : texto;
}

function nombreEstacion(reporte: ReporteEtl, serial: number): string {
  return reporte.estaciones.find((e) => e.codigo_serial === serial)?.nombre_corto ?? String(serial);
}
