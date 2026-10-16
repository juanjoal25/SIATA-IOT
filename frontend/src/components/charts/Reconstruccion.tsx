import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Marco, CajaTooltip, Leyenda, PROPS_REJILLA } from './Marco';
import { EJE, SERIE, TINTA, formatoNumero } from '../../lib/viz';

interface Punto {
  t: string;
  observado: number | null;
  serie: number | null;
  origen: string;
}

const ETIQUETA_ORIGEN: Record<string, string> = {
  observado: 'medición real',
  temporal: 'reconstruido con las horas vecinas',
  espacial: 'reconstruido con las estaciones vecinas',
  climatologia: 'reconstruido con el patrón histórico',
  sin_dato: 'sin dato',
};

/**
 * La reconstrucción, vista de cerca.
 *
 * Los puntos son mediciones que de verdad hizo el instrumento; la línea es la
 * serie completa que usa el sistema. Donde la línea avanza sin puntos debajo,
 * el pipeline está rellenando. Es la forma más honesta de enseñar qué parte del
 * dato es medición y qué parte es estimación.
 */
export function Reconstruccion({
  puntos,
  estacion,
  metricas,
}: {
  puntos: Punto[];
  estacion: string;
  metricas: { mae: number | null; rmse: number | null; n: number; sesgo: number | null } | null;
}) {
  const datos = puntos.map((p, i) => ({ ...p, i }));
  const huecos = puntos.filter((p) => p.origen !== 'observado').length;

  return (
    <Marco
      titulo="¿Qué parte del dato es medición y qué parte es estimación?"
      explicacion={
        <>
          Veinte días de la estación <strong>{estacion}</strong>, la que más huecos tuvo. Los puntos
          azules son mediciones reales del instrumento; la línea naranja es la serie completa que
          usa el sistema. Donde la línea avanza sola, el pipeline está rellenando: aquí son{' '}
          <strong>{huecos} de {puntos.length} horas</strong>.
        </>
      }
      pie={
        metricas
          ? `Para saber si ese relleno es fiable, el ETL esconde el 5 % de las mediciones buenas de toda la red (${metricas.n.toLocaleString('es-CO')} valores), las reconstruye con el mismo procedimiento y las compara: se equivoca en ${formatoNumero(metricas.mae)} µg/m³ en promedio, sin desviarse sistemáticamente hacia arriba ni hacia abajo (sesgo ${formatoNumero(metricas.sesgo, 2)}).`
          : undefined
      }
    >
      <Leyenda
        items={[
          { nombre: 'Medición real del sensor', color: SERIE.uno },
          { nombre: 'Serie reconstruida', color: SERIE.dos },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={datos} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
          <CartesianGrid {...PROPS_REJILLA} />
          <XAxis
            dataKey="t"
            tickFormatter={(t: string) => t.slice(5, 10)}
            minTickGap={50}
            {...EJE}
          />
          <YAxis unit=" µg" width={58} {...EJE} />
          <Tooltip cursor={{ stroke: TINTA.apagada, strokeDasharray: '3 3' }} content={<TooltipPunto />} />
          <Line
            dataKey="serie"
            stroke={SERIE.dos}
            strokeWidth={1.8}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: TINTA.superficie }}
            isAnimationActive={false}
            connectNulls
          />
          <Scatter dataKey="observado" fill={SERIE.uno} shape="circle" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Marco>
  );
}

function TooltipPunto({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: Punto = payload[0].payload;
  return (
    <CajaTooltip
      titulo={d.t}
      filas={[
        {
          etiqueta: 'Valor usado',
          valor: `${formatoNumero(d.serie)} µg/m³`,
          color: d.origen === 'observado' ? SERIE.uno : SERIE.dos,
        },
        { etiqueta: 'Origen', valor: ETIQUETA_ORIGEN[d.origen] ?? d.origen },
      ]}
    />
  );
}
