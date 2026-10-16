import { useMemo, useState } from 'react';
import { Marco } from './Marco';
import { RAMPA_AMBAR, formatoNumero, pasoRampa } from '../../lib/viz';

/**
 * Mapa de calor día de la semana × hora.
 *
 * Se pinta con CSS Grid y no con una librería: son 168 celdas de tamaño fijo,
 * y así el control del gap de 2 px y del foco por teclado es directo.
 *
 * La rampa es de un solo tono (ámbar) porque codifica **magnitud**, no
 * categorías: más oscuro = más limpio, más claro = más cargado. Un arcoíris
 * aquí inventaría fronteras que los datos no tienen.
 */
export function MapaCalor({
  dias,
  matriz,
  titulo,
  controles,
}: {
  dias: string[];
  matriz: (number | null)[][];
  titulo?: string;
  controles?: React.ReactNode;
}) {
  const [foco, setFoco] = useState<{ dia: number; hora: number } | null>(null);

  const { min, max, peor, mejor } = useMemo(() => {
    const planos = matriz.flat().filter((v): v is number => v !== null);
    let peorCelda = { dia: 0, hora: 0, valor: -Infinity };
    let mejorCelda = { dia: 0, hora: 0, valor: Infinity };
    matriz.forEach((fila, dia) =>
      fila.forEach((valor, hora) => {
        if (valor === null) return;
        if (valor > peorCelda.valor) peorCelda = { dia, hora, valor };
        if (valor < mejorCelda.valor) mejorCelda = { dia, hora, valor };
      }),
    );
    return {
      min: planos.length ? Math.min(...planos) : 0,
      max: planos.length ? Math.max(...planos) : 1,
      peor: peorCelda,
      mejor: mejorCelda,
    };
  }, [matriz]);

  const activa = foco ? matriz[foco.dia]?.[foco.hora] ?? null : null;

  return (
    <Marco
      titulo={titulo ?? '¿Qué días y a qué horas se concentra el problema?'}
      explicacion={
        <>
          Cada celda es el promedio de una hora concreta de un día concreto, a lo largo de todo el
          año. Lo peor cae el <strong>{dias[peor.dia]?.toLowerCase()} a las {peor.hora}:00</strong> (
          {formatoNumero(peor.valor)} µg/m³) y lo mejor, el{' '}
          <strong>{dias[mejor.dia]?.toLowerCase()} a las {mejor.hora}:00</strong> (
          {formatoNumero(mejor.valor)} µg/m³).
        </>
      }
      controles={controles}
      tabla={<TablaCalor dias={dias} matriz={matriz} />}
      pie="Pasa el cursor por una celda para ver su valor exacto."
    >
      <div className="calor-envoltura">
        <div className="calor-rejilla" role="img" aria-label="Mapa de calor de PM2.5 por día y hora">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div className="calor-hora" key={h}>
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
          {matriz.map((fila, dia) => (
            <div className="calor-fila" key={dias[dia]} style={{ display: 'contents' }}>
              <div className="calor-dia">{dias[dia]?.slice(0, 3)}</div>
              {fila.map((valor, hora) => (
                <div
                  key={hora}
                  className={`calor-celda${foco?.dia === dia && foco?.hora === hora ? ' activa' : ''}`}
                  style={{ background: pasoRampa(valor, min, max) }}
                  onMouseEnter={() => setFoco({ dia, hora })}
                  onMouseLeave={() => setFoco(null)}
                  title={`${dias[dia]} ${hora}:00 — ${formatoNumero(valor)} µg/m³`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="calor-pie">
        <div className="calor-escala">
          <span>{formatoNumero(min)}</span>
          <div className="calor-rampa">
            {RAMPA_AMBAR.map((color) => (
              <span key={color} style={{ background: color }} />
            ))}
          </div>
          <span>{formatoNumero(max)} µg/m³</span>
        </div>
        <div className="calor-lectura">
          {foco && activa !== null ? (
            <>
              <strong>{dias[foco.dia]}</strong> a las {String(foco.hora).padStart(2, '0')}:00 ·{' '}
              <strong>{formatoNumero(activa)} µg/m³</strong>
            </>
          ) : (
            'Más claro = más contaminado'
          )}
        </div>
      </div>
    </Marco>
  );
}

function TablaCalor({ dias, matriz }: { dias: string[]; matriz: (number | null)[][] }) {
  return (
    <div className="tabla-contenedor">
      <table>
        <thead>
          <tr>
            <th>Día</th>
            {Array.from({ length: 24 }, (_, h) => (
              <th className="num" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matriz.map((fila, dia) => (
            <tr key={dias[dia]}>
              <td>{dias[dia]}</td>
              {fila.map((valor, hora) => (
                <td className="num" key={hora}>
                  {formatoNumero(valor, 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
