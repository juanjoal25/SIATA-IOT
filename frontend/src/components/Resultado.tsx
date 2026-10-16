import type { RespuestaAire } from '../lib/types';

/** Tarjeta de diagnóstico: el color del semáforo es la información principal. */
export function Resultado({ datos, desdeCache }: { datos: RespuestaAire; desdeCache?: number | null }) {
  const { diagnostico: d } = datos;
  const sinDato = d.pm25 === null;

  return (
    <section
      className="resultado"
      style={{ ['--tono' as string]: d.hex, ['--halo' as string]: d.hex }}
      aria-live="polite"
    >
      <div className="disco">
        <div className="valor" style={{ color: sinDato ? 'var(--texto-3)' : d.hex }}>
          {sinDato ? '—' : d.pm25?.toFixed(1)}
        </div>
        <div className="unidad">µg/m³ PM2.5</div>
      </div>

      <div className="etiqueta-categoria" style={{ background: d.hex, color: contraste(d.hex) }}>
        {d.categoria}
      </div>

      <p className="recomendacion">{d.recomendacion}</p>

      <div className="meta-linea">
        {d.ica !== null && <span className="pildora">ICA {d.ica}</span>}
        <span className="pildora">{etiquetaMetodo(datos.metodo)}</span>
        <span className="pildora">promedio {datos.campo === 'pm25_24h' ? '24 h' : '1 h'}</span>
        {datos.pm25_1h !== null && <span className="pildora">última hora {datos.pm25_1h} µg/m³</span>}
        <span className="pildora">{datos.snapshot}</span>
      </div>

      {datos.estacion_mas_cercana && (
        <p className="nota">
          Estación más cercana: <strong>{datos.estacion_mas_cercana.nombre_corto}</strong>
          {datos.estacion_mas_cercana.distancia_km !== undefined &&
            ` a ${datos.estacion_mas_cercana.distancia_km.toFixed(2)} km`}
          {datos.estacion_mas_cercana.pm25_24h !== null &&
            ` · midió ${datos.estacion_mas_cercana.pm25_24h} µg/m³`}
        </p>
      )}

      {desdeCache && (
        <p className="nota">
          Sin conexión: se muestra el último diagnóstico guardado ({new Date(desdeCache).toLocaleString('es-CO')}).
        </p>
      )}
    </section>
  );
}

const ETIQUETAS: Record<string, string> = {
  linear: 'interpolación lineal',
  cubic: 'interpolación cúbica',
  nearest: 'vecino más cercano',
  idw: 'IDW en línea',
};

export const etiquetaMetodo = (metodo: string) => ETIQUETAS[metodo] ?? metodo;

/** Texto legible sobre el color del semáforo (el amarillo pide texto oscuro). */
export function contraste(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.6 ? '#0b1020' : '#ffffff';
}
