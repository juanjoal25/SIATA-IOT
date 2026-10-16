import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Marco, CajaTooltip, Leyenda, PROPS_REJILLA } from './Marco';
import { EJE, SERIE, TINTA, formatoNumero } from '../../lib/viz';

interface PuntoHora {
  hora: number;
  n: number;
  p10?: number | null;
  p25?: number | null;
  mediana?: number | null;
  p75?: number | null;
  p90?: number | null;
  media?: number | null;
}

/**
 * A qué hora está peor el aire.
 *
 * En vez de un diagrama de caja —preciso pero ilegible para quien no lo ha
 * visto antes— se dibuja la banda donde cae la mitad central de las mediciones
 * y la línea de la mediana. Se lee sin explicación: la línea es lo típico, la
 * banda es cuánto varía.
 */
export function PerfilHorario({ datos, titulo }: { datos: PuntoHora[]; titulo?: string }) {
  const conDato = datos.filter((d) => d.mediana !== null && d.mediana !== undefined);
  const peor = conDato.reduce((a, b) => ((b.mediana ?? 0) > (a.mediana ?? 0) ? b : a), conDato[0]!);
  const mejor = conDato.reduce((a, b) => ((b.mediana ?? 0) < (a.mediana ?? 0) ? b : a), conDato[0]!);

  const serie = datos.map((d) => ({
    ...d,
    banda: d.p25 !== null && d.p75 !== null ? [d.p25, d.p75] : undefined,
    bandaAmplia: d.p10 !== null && d.p90 !== null ? [d.p10, d.p90] : undefined,
  }));

  return (
    <Marco
      titulo={titulo ?? '¿A qué hora está peor el aire?'}
      explicacion={
        <>
          La línea es el valor típico (mediana) de cada hora del día a lo largo del año. La banda
          oscura es donde cae la mitad de las mediciones y la clara, donde cae el 80 %. El peor
          momento es hacia las <strong>{peor.hora}:00</strong> y el mejor, hacia las{' '}
          <strong>{mejor.hora}:00</strong>.
        </>
      }
      tabla={<TablaHoras datos={conDato} />}
      pie="Se usan solo mediciones observadas: los valores imputados quedan fuera para no suavizar artificialmente la distribución."
    >
      <Leyenda
        items={[
          { nombre: 'Valor típico (mediana)', color: SERIE.uno },
          { nombre: 'Mitad central de las horas', color: 'rgba(57,135,229,0.45)' },
          { nombre: '80 % de las horas', color: 'rgba(57,135,229,0.18)' },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={serie} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
          <CartesianGrid {...PROPS_REJILLA} />
          <XAxis dataKey="hora" tickFormatter={(h) => `${h}h`} interval={1} {...EJE} />
          <YAxis unit=" µg" width={58} {...EJE} />
          <Tooltip cursor={{ stroke: TINTA.apagada, strokeDasharray: '3 3' }} content={<TooltipHora />} />
          <Area
            dataKey="bandaAmplia"
            stroke="none"
            fill={SERIE.uno}
            fillOpacity={0.18}
            isAnimationActive={false}
            activeDot={false}
          />
          <Area
            dataKey="banda"
            stroke="none"
            fill={SERIE.uno}
            fillOpacity={0.3}
            isAnimationActive={false}
            activeDot={false}
          />
          {/* Umbral de la norma: por encima de 37 µg/m³ el semáforo deja de ser amarillo. */}
          <ReferenceLine
            y={37}
            stroke="#ff7e00"
            strokeDasharray="5 4"
            label={{ value: 'Umbral naranja (37)', position: 'insideTopRight', fill: '#ff7e00', fontSize: 11 }}
          />
          <Line
            dataKey="mediana"
            stroke={SERIE.uno}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: TINTA.superficie }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Marco>
  );
}

function TooltipHora({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d: PuntoHora = payload[0].payload;
  return (
    <CajaTooltip
      titulo={`${String(label).padStart(2, '0')}:00`}
      filas={[
        { etiqueta: 'Típico (mediana)', valor: `${formatoNumero(d.mediana)} µg/m³`, color: SERIE.uno },
        { etiqueta: 'Mitad central', valor: `${formatoNumero(d.p25)} – ${formatoNumero(d.p75)}` },
        { etiqueta: '80 % de las horas', valor: `${formatoNumero(d.p10)} – ${formatoNumero(d.p90)}` },
        { etiqueta: 'Mediciones', valor: d.n.toLocaleString('es-CO') },
      ]}
    />
  );
}

function TablaHoras({ datos }: { datos: PuntoHora[] }) {
  return (
    <div className="tabla-contenedor">
      <table>
        <thead>
          <tr>
            <th>Hora</th>
            <th className="num">p10</th>
            <th className="num">p25</th>
            <th className="num">Mediana</th>
            <th className="num">p75</th>
            <th className="num">p90</th>
            <th className="num">Mediciones</th>
          </tr>
        </thead>
        <tbody>
          {datos.map((d) => (
            <tr key={d.hora}>
              <td>{String(d.hora).padStart(2, '0')}:00</td>
              <td className="num">{formatoNumero(d.p10)}</td>
              <td className="num">{formatoNumero(d.p25)}</td>
              <td className="num">{formatoNumero(d.mediana)}</td>
              <td className="num">{formatoNumero(d.p75)}</td>
              <td className="num">{formatoNumero(d.p90)}</td>
              <td className="num">{d.n.toLocaleString('es-CO')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
