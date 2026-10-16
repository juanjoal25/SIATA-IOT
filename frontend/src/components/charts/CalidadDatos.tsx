import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Marco, CajaTooltip, PROPS_REJILLA } from './Marco';
import { EJE, SERIE, TINTA, formatoPct } from '../../lib/viz';

interface FilaAuditoria {
  nombre_corto: string;
  registros: number;
  sanos: number;
  descartados: number;
  sin_registro: number;
  falla_sensor: number;
  incoherente: number;
  marcados_conservados: number;
  pct_descartado: number;
}

/**
 * Cuántos datos hubo que descartar en cada estación.
 *
 * Se grafica el **porcentaje descartado** y no la barra apilada «sano vs.
 * descartado»: como todas las estaciones conservan más del 90 %, en una barra
 * al 100 % el segmento que de verdad interesa queda invisible. Con el eje
 * ajustado al rango real se ve de inmediato qué estaciones pierden más señal.
 *
 * El color es el naranja categórico y no el rojo de estado: no hay aquí un
 * umbral de «malo», solo una magnitud a comparar entre estaciones.
 */
export function CalidadDatos({
  filas,
  global: totales,
  familias,
}: {
  filas: FilaAuditoria[];
  global: Record<string, number>;
  familias: Record<string, string>;
}) {
  const datos = [...filas].sort((a, b) => b.pct_descartado - a.pct_descartado);
  const techo = Math.max(2, Math.ceil(Math.max(...datos.map((f) => f.pct_descartado)) * 1.2));

  return (
    <Marco
      titulo="¿Qué tan confiables son los datos de origen?"
      explicacion={
        <>
          De cada estación llegan 8.761 mediciones horarias al año, y no todas sirven: hay códigos
          de «sin dato», lecturas negativas, saturaciones del sensor y valores que se contradicen
          con el resto del valle. En toda la red se pudo usar el{' '}
          <strong>{formatoPct(100 - totales.pct_descartado!)}</strong> de lo recibido. Abajo, las
          estaciones que más señal perdieron.
        </>
      }
      tabla={<TablaAuditoria filas={filas} familias={familias} />}
      pie={
        <>
          El SIATA además marca {totales.marcados_conservados?.toLocaleString('es-CO')} registros
          como no validados. No se eliminan —serían demasiados— pero quedan señalados en el reporte
          del ETL para poder auditarlos.
        </>
      }
    >
      <ResponsiveContainer width="100%" height={Math.max(300, datos.length * 24)}>
        <BarChart layout="vertical" data={datos} margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
          <CartesianGrid {...PROPS_REJILLA} vertical horizontal={false} />
          <XAxis
            type="number"
            domain={[0, techo]}
            unit="%"
            label={{
              value: 'Porcentaje de mediciones descartadas',
              position: 'insideBottom',
              offset: -2,
              fill: TINTA.apagada,
              fontSize: 11,
            }}
            {...EJE}
          />
          <YAxis type="category" dataKey="nombre_corto" width={78} {...EJE} />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} content={<TooltipAuditoria />} />
          <Bar
            dataKey="pct_descartado"
            fill={SERIE.dos}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="pct_descartado"
              position="right"
              formatter={(v) => (typeof v === 'number' ? `${v.toFixed(1)} %` : '')}
              style={{ fill: TINTA.secundaria, fontSize: 10.5 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Marco>
  );
}

function TooltipAuditoria({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: FilaAuditoria = payload[0].payload;
  return (
    <CajaTooltip
      titulo={d.nombre_corto}
      filas={[
        { etiqueta: 'Utilizables', valor: d.sanos.toLocaleString('es-CO'), color: SERIE.uno },
        { etiqueta: 'Descartados', valor: d.descartados.toLocaleString('es-CO'), color: SERIE.dos },
        { etiqueta: 'Falla del sensor', valor: d.falla_sensor.toLocaleString('es-CO') },
        { etiqueta: 'Incoherentes', valor: d.incoherente.toLocaleString('es-CO') },
        { etiqueta: 'Marcados por SIATA', valor: d.marcados_conservados.toLocaleString('es-CO') },
      ]}
    />
  );
}

function TablaAuditoria({
  filas,
  familias,
}: {
  filas: FilaAuditoria[];
  familias: Record<string, string>;
}) {
  return (
    <>
      <div className="tabla-contenedor">
        <table>
          <thead>
            <tr>
              <th>Estación</th>
              <th className="num">Registros</th>
              <th className="num">Utilizables</th>
              <th className="num">Descartados</th>
              <th className="num">% descartado</th>
              <th className="num">Falla sensor</th>
              <th className="num">Incoherentes</th>
              <th className="num">Marcados</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.nombre_corto}>
                <td>{f.nombre_corto}</td>
                <td className="num">{f.registros.toLocaleString('es-CO')}</td>
                <td className="num">{f.sanos.toLocaleString('es-CO')}</td>
                <td className="num">{f.descartados.toLocaleString('es-CO')}</td>
                <td className="num">{formatoPct(f.pct_descartado, 2)}</td>
                <td className="num">{f.falla_sensor.toLocaleString('es-CO')}</td>
                <td className="num">{f.incoherente.toLocaleString('es-CO')}</td>
                <td className="num">{f.marcados_conservados.toLocaleString('es-CO')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="leyenda" style={{ marginTop: 12 }}>
        {Object.entries(familias).map(([clave, descripcion]) => (
          <div className="leyenda-fila" key={clave}>
            <span />
            <span>
              <strong>{clave.replace(/_/g, ' ')}</strong>: {descripcion}
            </span>
            <span />
          </div>
        ))}
      </div>
    </>
  );
}
