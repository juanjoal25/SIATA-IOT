import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Marco, CajaTooltip, Leyenda } from './Marco';
import { EJE, HEX_ICA, NOMBRE_ICA, ORDEN_ICA, TINTA, tintaSobre, formatoPct } from '../../lib/viz';
import type { SlugIca } from '../../lib/viz';

interface FilaSemaforo {
  nombre_corto: string;
  horas: number;
  verde: number;
  amarillo: number;
  naranja: number;
  rojo: number;
  purpura: number;
  marron: number;
}

/** Barra única de 100 % con el reparto del año en todo el valle. */
export function SemaforoGlobal({ global: datos }: { global: Record<string, number> }) {
  const tramos = ORDEN_ICA.filter((slug) => (datos[slug] ?? 0) > 0);
  return (
    <div>
      <div className="barra-semaforo">
        {tramos.map((slug) => (
          <span
            key={slug}
            style={{ width: `${datos[slug]}%`, background: HEX_ICA[slug], color: tintaSobre(HEX_ICA[slug]) }}
            title={`${NOMBRE_ICA[slug]}: ${formatoPct(datos[slug])}`}
          >
            {(datos[slug] ?? 0) >= 6 ? `${Math.round(datos[slug]!)} %` : ''}
          </span>
        ))}
      </div>
      <div className="leyenda-viz">
        {tramos.map((slug) => (
          <span className="leyenda-item" key={slug}>
            <span className="punto-color" style={{ background: HEX_ICA[slug] }} />
            {NOMBRE_ICA[slug]} · <strong>{formatoPct(datos[slug])}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ranking de estaciones por cuánto tiempo pasan en cada color. */
export function SemaforoEstaciones({ filas }: { filas: FilaSemaforo[] }) {
  const presentes = ORDEN_ICA.filter((slug) => filas.some((f) => (f[slug] ?? 0) > 0));

  return (
    <Marco
      titulo="¿Dónde se respira mejor?"
      explicacion={
        <>
          Cada barra es una estación y muestra qué porcentaje del año pasó en cada color del
          semáforo. Arriba, las que más horas estuvieron en verde. Es la lectura más directa de
          «¿qué tan limpio es el aire en mi zona?».
        </>
      }
      tabla={<TablaSemaforo filas={filas} presentes={presentes} />}
      pie="Calculado sobre la media móvil de 24 horas, que es la base que define la norma para PM2.5."
    >
      <Leyenda items={presentes.map((slug) => ({ nombre: NOMBRE_ICA[slug], color: HEX_ICA[slug] }))} />
      <ResponsiveContainer width="100%" height={Math.max(320, filas.length * 26)}>
        <BarChart layout="vertical" data={filas} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          {/* Ticks explícitos: los porcentajes vienen redondeados por estación
              y el máximo automático salía en «100,01 %». */}
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            unit="%"
            allowDataOverflow
            {...EJE}
          />
          <YAxis type="category" dataKey="nombre_corto" width={78} {...EJE} />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} content={<TooltipSemaforo />} />
          {presentes.map((slug) => (
            <Bar
              key={slug}
              dataKey={slug}
              stackId="semaforo"
              fill={HEX_ICA[slug]}
              // El trazo del color de la superficie crea el separador de 2 px
              // entre segmentos apilados.
              stroke={TINTA.superficie}
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slug === 'amarillo' || slug === 'verde' ? (
                <LabelList
                  dataKey={slug}
                  position="center"
                  // Solo se rotula el segmento cuando hay sitio para el número.
                  formatter={(v) => (typeof v === 'number' && v >= 12 ? `${Math.round(v)}%` : '')}
                  style={{ fill: tintaSobre(HEX_ICA[slug]), fontSize: 10, fontWeight: 700 }}
                />
              ) : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Marco>
  );
}

function TooltipSemaforo({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <CajaTooltip
      titulo={label}
      filas={payload
        .filter((p: any) => p.value > 0)
        .reverse()
        .map((p: any) => ({
          etiqueta: NOMBRE_ICA[p.dataKey as SlugIca],
          valor: formatoPct(p.value),
          color: p.color,
        }))}
    />
  );
}

function TablaSemaforo({ filas, presentes }: { filas: FilaSemaforo[]; presentes: readonly SlugIca[] }) {
  return (
    <div className="tabla-contenedor">
      <table>
        <thead>
          <tr>
            <th>Estación</th>
            {presentes.map((slug) => (
              <th className="num" key={slug}>
                {NOMBRE_ICA[slug]}
              </th>
            ))}
            <th className="num">Horas</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.nombre_corto}>
              <td>{fila.nombre_corto}</td>
              {presentes.map((slug) => (
                <td className="num" key={slug}>
                  {formatoPct(fila[slug])}
                </td>
              ))}
              <td className="num">{fila.horas.toLocaleString('es-CO')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Reexportado para que la vista pueda pintar celdas sueltas con el mismo color. */
export { Cell };
