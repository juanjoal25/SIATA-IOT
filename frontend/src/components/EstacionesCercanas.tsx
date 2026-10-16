import type { Estacion } from '../lib/types';

/**
 * Estaciones reales que sostienen el diagnóstico. Es la parte auditable del
 * resultado: el usuario puede contrastar el valor interpolado con lo que de
 * verdad midió un instrumento.
 */
export function EstacionesCercanas({ estaciones }: { estaciones: Estacion[] }) {
  if (estaciones.length === 0) return null;

  return (
    <section className="tarjeta">
      <h2>Estaciones que sostienen el cálculo</h2>
      <div className="tabla-contenedor">
        <table>
          <thead>
            <tr>
              <th>Estación</th>
              <th className="num">Distancia</th>
              <th className="num">PM2.5 24 h</th>
              <th>Categoría</th>
              <th className="num">Horas obs.</th>
            </tr>
          </thead>
          <tbody>
            {estaciones.map((est) => (
              <tr key={est.codigo_serial}>
                <td title={est.nombre}>
                  {est.nombre_corto}
                  {est.nodo_interpolacion === false && (
                    <span
                      className="marca-trafico"
                      title="Estación de tráfico: mide una calzada, no el aire de fondo. Se muestra como referencia, pero no entra en el cálculo."
                    >
                      tráfico
                    </span>
                  )}
                </td>
                <td className="num">
                  {est.distancia_km !== undefined ? `${est.distancia_km.toFixed(2)} km` : '—'}
                </td>
                <td className="num">{est.pm25_24h ?? '—'}</td>
                <td>
                  <span className="punto-color" style={{ background: est.hex ?? '#6b7280', marginRight: 6 }} />
                  {est.categoria ?? '—'}
                </td>
                <td className="num">{est.horas_observadas_24h ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {estaciones.some((e) => e.nodo_interpolacion === false) && (
        <p className="nota">
          Las estaciones marcadas como <em>tráfico</em> miden el microentorno de una calzada, no el
          aire de fondo del sector: aparecen como referencia pero no se usan para interpolar.
        </p>
      )}
    </section>
  );
}
