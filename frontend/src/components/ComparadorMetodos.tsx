import type { Comparacion } from '../lib/types';
import { etiquetaMetodo } from './Resultado';

/**
 * Comparación de los métodos de interpolación en el mismo punto.
 *
 * Que los tres coincidan es señal de que el punto está bien cubierto por la
 * red; una diferencia grande indica que el usuario está lejos de cualquier
 * estación y el valor depende del método elegido.
 */
export function ComparadorMetodos({
  comparacion,
  activo,
  alElegir,
}: {
  comparacion: Comparacion;
  activo: string;
  alElegir?: (metodo: string) => void;
}) {
  const entradas = Object.entries(comparacion);
  const valores = entradas.map(([, v]) => v.pm25).filter((v): v is number => v !== null);
  const dispersion = valores.length > 1 ? Math.max(...valores) - Math.min(...valores) : 0;

  return (
    <section className="tarjeta">
      <h2>Comparación de métodos</h2>
      <p>
        El mismo punto estimado con cada método de interpolación espacial. Dispersión entre
        métodos: <strong>{dispersion.toFixed(1)} µg/m³</strong>
        {dispersion > 5 && ' — el punto está lejos de las estaciones, tómalo como referencia.'}
      </p>

      <div className="metodos">
        {entradas.map(([metodo, valor]) => (
          <button
            key={metodo}
            type="button"
            className={`metodo${metodo === activo ? ' activo' : ''}`}
            aria-pressed={metodo === activo}
            onClick={() => alElegir?.(metodo)}
            style={{ textAlign: 'left', cursor: alElegir ? 'pointer' : 'default' }}
          >
            <div className="nombre">
              <span>{etiquetaMetodo(metodo)}</span>
              <span className="punto-color" style={{ background: valor.hex }} />
            </div>
            <div className="cifra">{valor.pm25 === null ? '—' : valor.pm25.toFixed(1)}</div>
            <div className="cat">{valor.categoria}</div>
            {valor.extrapolado && <div className="cat">extrapolado</div>}
          </button>
        ))}
      </div>
    </section>
  );
}
