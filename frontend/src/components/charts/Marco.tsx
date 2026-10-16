import { useId, useState, type ReactNode } from 'react';
import { TINTA } from '../../lib/viz';

/**
 * Marco común de las gráficas: título, una frase que explica qué se está
 * mirando y el conmutador a vista de tabla.
 *
 * La tabla no es un extra: el semáforo del ICA es una paleta normativa que no
 * podemos recolorear y cuyo púrpura y marrón quedan por debajo del contraste
 * mínimo contra el fondo. La tabla es la vía de lectura alternativa que hace
 * que el color nunca cargue solo con el significado.
 */
export function Marco({
  titulo,
  explicacion,
  children,
  tabla,
  controles,
  pie,
}: {
  titulo: string;
  explicacion: ReactNode;
  children: ReactNode;
  tabla?: ReactNode;
  controles?: ReactNode;
  pie?: ReactNode;
}) {
  const [verTabla, setVerTabla] = useState(false);
  const id = useId();

  return (
    <section className="tarjeta">
      <div className="grafica-cabecera">
        <h2 id={id}>{titulo}</h2>
        {tabla && (
          <button
            type="button"
            className="boton-secundario"
            aria-pressed={verTabla}
            onClick={() => setVerTabla((v) => !v)}
          >
            {verTabla ? 'Ver gráfica' : 'Ver tabla'}
          </button>
        )}
      </div>
      <p className="explicacion">{explicacion}</p>
      {controles}
      <div aria-labelledby={id}>{verTabla && tabla ? tabla : children}</div>
      {pie && <p className="nota">{pie}</p>}
    </section>
  );
}

/** Tooltip compartido: una caja oscura con el mismo estilo que la app. */
export function CajaTooltip({
  titulo,
  filas,
}: {
  titulo: ReactNode;
  filas: { etiqueta: string; valor: ReactNode; color?: string }[];
}) {
  return (
    <div className="tooltip-viz">
      <div className="tooltip-titulo">{titulo}</div>
      {filas.map((fila) => (
        <div className="tooltip-fila" key={fila.etiqueta}>
          {fila.color && <span className="punto-color" style={{ background: fila.color }} />}
          <span>{fila.etiqueta}</span>
          <strong>{fila.valor}</strong>
        </div>
      ))}
    </div>
  );
}

/** Leyenda propia: la de Recharts no respeta la tipografía de la app. */
export function Leyenda({ items }: { items: { nombre: string; color: string }[] }) {
  return (
    <div className="leyenda-viz">
      {items.map((item) => (
        <span className="leyenda-item" key={item.nombre}>
          <span className="punto-color" style={{ background: item.color }} />
          {item.nombre}
        </span>
      ))}
    </div>
  );
}

/** Rejilla y ejes con el mismo aspecto en todas las gráficas. */
export const PROPS_REJILLA = {
  stroke: TINTA.rejilla,
  strokeDasharray: '2 4',
  vertical: false,
} as const;
