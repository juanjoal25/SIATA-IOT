import { useEffect, useMemo, useState } from 'react';
import { ApiError, obtenerAnalitica } from '../lib/api';
import type { Analitica } from '../lib/types';
import { SemaforoEstaciones, SemaforoGlobal } from '../components/charts/SemaforoEstaciones';
import { PerfilHorario } from '../components/charts/PerfilHorario';
import { MapaCalor } from '../components/charts/MapaCalor';
import { SerieAnual } from '../components/charts/SerieAnual';
import { CalidadDatos } from '../components/charts/CalidadDatos';
import { Reconstruccion } from '../components/charts/Reconstruccion';
import { HEX_ICA, NOMBRE_ICA, ORDEN_ICA, formatoNumero, formatoPct } from '../lib/viz';

const TODO_EL_VALLE = 'valle';

/**
 * Lectura para cualquiera: qué dice un año de mediciones del SIATA.
 *
 * El orden es deliberado — primero la respuesta («cómo estuvo el aire»), luego
 * el detalle geográfico y temporal, y al final la trastienda de los datos.
 * Quien solo lee lo primero ya se lleva la conclusión.
 */
export function Analisis() {
  const [datos, setDatos] = useState<Analitica | null>(null);
  const [error, setError] = useState<{ mensaje: string; sinEtl: boolean } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [estacion, setEstacion] = useState<string>(TODO_EL_VALLE);

  useEffect(() => {
    let vivo = true;
    obtenerAnalitica()
      .then((a) => vivo && setDatos(a))
      .catch((fallo) => {
        if (!vivo) return;
        const api = fallo instanceof ApiError ? fallo : null;
        setError({
          mensaje: api?.message ?? 'No se pudo cargar la analítica.',
          sinEtl: api?.code === 'etl_no_ejecutado',
        });
      })
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const opciones = useMemo(() => {
    if (!datos) return [];
    return Object.entries(datos.perfil_horario.nombres).sort((a, b) => a[1].localeCompare(b[1]));
  }, [datos]);

  if (cargando) {
    return (
      <section className="tarjeta">
        <h2>Análisis</h2>
        <div className="leyenda">
          {[90, 70, 80, 60].map((ancho) => (
            <div key={ancho} className="esqueleto" style={{ width: `${ancho}%` }} />
          ))}
        </div>
      </section>
    );
  }

  if (error || !datos) {
    return (
      <section className="tarjeta">
        <h2>Análisis</h2>
        <div className={`aviso ${error?.sinEtl ? 'alerta' : 'error'}`}>
          <span aria-hidden>⚠</span>
          <span>
            {error?.sinEtl ? (
              <>
                El análisis se calcula en el ETL. Ejecuta <code>python -m etl.run</code> para
                generarlo.
              </>
            ) : (
              error?.mensaje
            )}
          </span>
        </div>
      </section>
    );
  }

  const { auditoria, semaforo, perfil_horario, heatmap, serie_diaria, serie_ejemplo } = datos;
  const validacion = datos.validacion_imputacion;
  const perfil = estacion === TODO_EL_VALLE ? perfil_horario.valle : perfil_horario.por_estacion[estacion]!;
  const matriz = estacion === TODO_EL_VALLE ? heatmap.valle : heatmap.por_estacion[estacion]!;
  const nombreSeleccion =
    estacion === TODO_EL_VALLE ? 'todo el valle' : perfil_horario.nombres[estacion] ?? estacion;

  const selector = (
    <div className="selector">
      <button
        type="button"
        aria-pressed={estacion === TODO_EL_VALLE}
        onClick={() => setEstacion(TODO_EL_VALLE)}
      >
        Todo el valle
      </button>
      {opciones.map(([serial, nombre]) => (
        <button
          key={serial}
          type="button"
          aria-pressed={estacion === serial}
          onClick={() => setEstacion(serial)}
        >
          {nombre}
        </button>
      ))}
    </div>
  );

  const diasMedidos = serie_diaria.fechas.length;
  const peorEstacion = semaforo.por_estacion[semaforo.por_estacion.length - 1];
  const mejorEstacion = semaforo.por_estacion[0];

  return (
    <>
      <section className="tarjeta">
        <h2>Así estuvo el aire del Valle de Aburrá</h2>
        <p className="explicacion">
          Un año completo de mediciones — {diasMedidos} días, 21 estaciones, 183.981 mediciones
          horarias — resumido en una sola barra. Cada color es el porcentaje del tiempo que el aire
          estuvo en ese nivel.
        </p>
        <SemaforoGlobal global={semaforo.global} />
        <div className="kpis" style={{ marginTop: 18 }}>
          <Kpi
            etiqueta="Aire aceptable o mejor"
            cifra={formatoPct((semaforo.global.verde ?? 0) + (semaforo.global.amarillo ?? 0))}
            pie="del tiempo en verde o amarillo"
          />
          <Kpi
            etiqueta="Aire dañino"
            cifra={formatoPct(
              ORDEN_ICA.slice(2).reduce((acc, slug) => acc + (semaforo.global[slug] ?? 0), 0),
            )}
            pie="naranja o peor: riesgo para grupos sensibles"
          />
          <Kpi
            etiqueta="Mejor zona"
            cifra={mejorEstacion?.nombre_corto ?? '—'}
            pie={`${formatoPct(mejorEstacion?.verde)} del año en verde`}
          />
          <Kpi
            etiqueta="Zona más cargada"
            cifra={peorEstacion?.nombre_corto ?? '—'}
            pie={`${formatoPct(peorEstacion?.verde)} del año en verde`}
          />
        </div>
        <p className="nota">
          Periodo analizado: {datos.rango.desde.slice(0, 10)} a {datos.rango.hasta.slice(0, 10)}.
        </p>
      </section>

      <SerieAnual fechas={serie_diaria.fechas} valores={serie_diaria.valle} />

      <SemaforoEstaciones filas={semaforo.por_estacion} />

      <section className="tarjeta">
        <h2>Mirar una estación en concreto</h2>
        <p className="explicacion">
          Las dos gráficas siguientes se refieren a <strong>{nombreSeleccion}</strong>. Cambia la
          selección para comparar zonas.
        </p>
        {selector}
      </section>

      <PerfilHorario
        datos={perfil}
        titulo={`¿A qué hora está peor el aire en ${nombreSeleccion}?`}
      />

      <MapaCalor dias={heatmap.dias} matriz={matriz} />

      <CalidadDatos
        filas={auditoria.por_estacion}
        global={auditoria.global}
        familias={auditoria.familias}
      />

      <Reconstruccion
        puntos={serie_ejemplo.puntos}
        estacion={serie_ejemplo.nombre_corto}
        metricas={validacion.aplicable && validacion.global ? validacion.global : null}
      />

      {validacion.aplicable && validacion.por_metodo && (
        <section className="tarjeta">
          <h2>Precisión de cada estrategia de relleno</h2>
          <p className="explicacion">
            El error se mide escondiendo mediciones buenas y pidiéndole al sistema que las adivine.
            Cuanto menor el error medio, más fiable es el relleno.
          </p>
          <div className="tabla-contenedor">
            <table style={{ minWidth: 380 }}>
              <thead>
                <tr>
                  <th>Estrategia</th>
                  <th className="num">Valores probados</th>
                  <th className="num">Error medio</th>
                  <th className="num">RMSE</th>
                  <th className="num">Sesgo</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(validacion.por_metodo).map(([metodo, m]) => (
                  <tr key={metodo}>
                    <td>{ETIQUETA_METODO[metodo] ?? metodo}</td>
                    <td className="num">{m.n.toLocaleString('es-CO')}</td>
                    <td className="num">{formatoNumero(m.mae, 2)}</td>
                    <td className="num">{formatoNumero(m.rmse, 2)}</td>
                    <td className="num">{formatoNumero(m.sesgo, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="nota">
            Errores en µg/m³. El enmascaramiento es aleatorio con semilla fija, así que el número es
            reproducible entre corridas.
          </p>
        </section>
      )}

      <section className="tarjeta">
        <h2>Cómo leer el semáforo</h2>
        <div className="leyenda">
          {ORDEN_ICA.map((slug) => {
            const tramo = semaforo.escala.find((t) => t.slug === slug);
            return (
              <div className="leyenda-fila" key={slug}>
                <span className="muestra" style={{ background: HEX_ICA[slug] }} />
                <span>{NOMBRE_ICA[slug]}</span>
                <span className="rango">
                  {tramo ? `${tramo.pm25_min}–${tramo.pm25_max} µg/m³` : ''}
                </span>
              </div>
            );
          })}
        </div>
        <p className="nota">{semaforo.base}. Resolución 2254 de 2017 (MinAmbiente).</p>
      </section>
    </>
  );
}

const ETIQUETA_METODO: Record<string, string> = {
  temporal: 'Con las horas vecinas de la misma estación',
  espacial: 'Con las estaciones vecinas, reescaladas',
  climatologia: 'Con el patrón histórico de ese mes y hora',
};

function Kpi({ etiqueta, cifra, pie }: { etiqueta: string; cifra: string; pie?: string }) {
  return (
    <div className="kpi">
      <div className="etiqueta">{etiqueta}</div>
      <div className="cifra">{cifra}</div>
      {pie && <div className="pie">{pie}</div>}
    </div>
  );
}
