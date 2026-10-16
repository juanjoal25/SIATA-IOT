import { useMemo } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Marco, CajaTooltip, Leyenda, PROPS_REJILLA } from './Marco';
import { EJE, HEX_ICA, NOMBRE_ICA, SERIE, TINTA, categoriaDe, formatoNumero } from '../../lib/viz';

/**
 * Evolución del año con las franjas del semáforo de fondo.
 *
 * Es la gráfica del cuaderno original llevada a toda la red: el promedio diario
 * del valle sobre las bandas del ICA, para que se vea de un vistazo cuándo el
 * año se salió de «moderado».
 */
export function SerieAnual({
  fechas,
  valores,
}: {
  fechas: string[];
  valores: (number | null)[];
}) {
  const datos = useMemo(
    () => fechas.map((fecha, i) => ({ fecha, valor: valores[i] ?? null })),
    [fechas, valores],
  );

  const validos = valores.filter((v): v is number => v !== null);
  const max = validos.length ? Math.max(...validos) : 50;
  const peorDia = datos.reduce((a, b) => ((b.valor ?? 0) > (a.valor ?? 0) ? b : a), datos[0]!);
  const diasNaranja = validos.filter((v) => v > 37).length;

  // El mes más y menos cargado se calculan, no se dan por sabidos: el patrón
  // estacional del valle cambia de un año a otro.
  const { peorMes, mejorMes } = useMemo(() => {
    const meses = new Map<string, number[]>();
    for (const { fecha, valor } of datos) {
      if (valor === null) continue;
      const mes = fecha.slice(0, 7);
      meses.set(mes, [...(meses.get(mes) ?? []), valor]);
    }
    const medias = [...meses.entries()].map(([mes, vs]) => ({
      mes,
      media: vs.reduce((a, b) => a + b, 0) / vs.length,
    }));
    if (medias.length === 0) return { peorMes: null, mejorMes: null };
    return {
      peorMes: medias.reduce((a, b) => (b.media > a.media ? b : a)),
      mejorMes: medias.reduce((a, b) => (b.media < a.media ? b : a)),
    };
  }, [datos]);

  // Las franjas se recortan al rango que los datos realmente alcanzan: pintar
  // hasta «peligroso» cuando el año no pasó de 45 µg/m³ deforma la escala.
  const techo = Math.ceil(Math.max(max * 1.1, 40));
  const bandas = [
    { desde: 0, hasta: 12, slug: 'verde' as const },
    { desde: 12, hasta: 37, slug: 'amarillo' as const },
    { desde: 37, hasta: 55, slug: 'naranja' as const },
    { desde: 55, hasta: 150, slug: 'rojo' as const },
  ].filter((b) => b.desde < techo);

  return (
    <Marco
      titulo="El año completo, día a día"
      explicacion={
        <>
          Promedio diario de PM2.5 en toda la red sobre las franjas del semáforo. El peor día fue el{' '}
          <strong>{peorDia.fecha}</strong> con <strong>{formatoNumero(peorDia.valor)} µg/m³</strong>,
          y hubo <strong>{diasNaranja} días</strong> por encima del umbral naranja.
        </>
      }
      tabla={<TablaMeses datos={datos} />}
      pie={
        peorMes && mejorMes
          ? `El mes más cargado fue ${nombreMes(peorMes.mes)} (${formatoNumero(peorMes.media)} µg/m³ de promedio) y el más limpio, ${nombreMes(mejorMes.mes)} (${formatoNumero(mejorMes.media)}). En el Valle de Aburrá esos picos se asocian a las épocas en que la inversión térmica atrapa las partículas cerca del suelo.`
          : undefined
      }
    >
      <Leyenda
        items={bandas.map((b) => ({ nombre: NOMBRE_ICA[b.slug], color: HEX_ICA[b.slug] }))}
      />
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={datos} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
          {bandas.map((banda) => (
            <ReferenceArea
              key={banda.slug}
              y1={banda.desde}
              y2={Math.min(banda.hasta, techo)}
              fill={HEX_ICA[banda.slug]}
              fillOpacity={0.17}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          <CartesianGrid {...PROPS_REJILLA} />
          <XAxis
            dataKey="fecha"
            tickFormatter={(f: string) => f.slice(5)}
            minTickGap={44}
            {...EJE}
          />
          <YAxis domain={[0, techo]} unit=" µg" width={58} {...EJE} />
          <Tooltip cursor={{ stroke: TINTA.apagada, strokeDasharray: '3 3' }} content={<TooltipDia />} />
          {/* Sin relleno bajo la línea: compite con las franjas del semáforo,
              que son las que aquí llevan el significado. */}
          <Line
            dataKey="valor"
            stroke={TINTA.primaria}
            strokeWidth={1.6}
            dot={false}
            activeDot={{ r: 5, fill: SERIE.uno, strokeWidth: 2, stroke: TINTA.superficie }}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Marco>
  );
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** `2019-03` -> `marzo de 2019`. */
function nombreMes(clave: string): string {
  const [anio, mes] = clave.split('-');
  return `${MESES[Number(mes) - 1] ?? clave} de ${anio}`;
}

function TooltipDia({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { fecha, valor } = payload[0].payload;
  if (valor === null) return null;
  const slug = categoriaDe(valor);
  return (
    <CajaTooltip
      titulo={fecha}
      filas={[
        { etiqueta: 'Promedio del día', valor: `${formatoNumero(valor)} µg/m³` },
        { etiqueta: 'Semáforo', valor: NOMBRE_ICA[slug], color: HEX_ICA[slug] },
      ]}
    />
  );
}

/** Resumen mensual: 12 filas se leen; 366 no. */
function TablaMeses({ datos }: { datos: { fecha: string; valor: number | null }[] }) {
  const meses = new Map<string, number[]>();
  for (const { fecha, valor } of datos) {
    if (valor === null) continue;
    const mes = fecha.slice(0, 7);
    meses.set(mes, [...(meses.get(mes) ?? []), valor]);
  }
  return (
    <div className="tabla-contenedor">
      <table>
        <thead>
          <tr>
            <th>Mes</th>
            <th className="num">Promedio</th>
            <th className="num">Máximo</th>
            <th className="num">Días &gt; 37</th>
            <th className="num">Días</th>
          </tr>
        </thead>
        <tbody>
          {[...meses.entries()].map(([mes, valores]) => (
            <tr key={mes}>
              <td>{mes}</td>
              <td className="num">{formatoNumero(valores.reduce((a, b) => a + b, 0) / valores.length)}</td>
              <td className="num">{formatoNumero(Math.max(...valores))}</td>
              <td className="num">{valores.filter((v) => v > 37).length}</td>
              <td className="num">{valores.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
