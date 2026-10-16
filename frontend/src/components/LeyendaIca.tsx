import { useEffect, useState } from 'react';
import { obtenerEscala } from '../lib/api';
import type { Slug, TramoEscala } from '../lib/types';

/** Semáforo completo del ICA, resaltando el tramo en el que cayó el usuario. */
export function LeyendaIca({ activo }: { activo?: Slug }) {
  const [escala, setEscala] = useState<TramoEscala[]>([]);

  useEffect(() => {
    obtenerEscala()
      .then(({ escala: tabla }) => setEscala(tabla))
      .catch(() => setEscala([]));
  }, []);

  if (escala.length === 0) return null;

  return (
    <section className="tarjeta">
      <h2>Semáforo del ICA · PM2.5</h2>
      <div className="leyenda">
        {escala.map((tramo) => (
          <div key={tramo.slug} className={`leyenda-fila${tramo.slug === activo ? ' activa' : ''}`}>
            <span className="muestra" style={{ background: tramo.hex }} />
            <span>
              {tramo.categoria}
              {tramo.slug === activo && <strong> · tu ubicación</strong>}
            </span>
            <span className="rango">
              {tramo.pm25_min}–{tramo.pm25_max} µg/m³
            </span>
          </div>
        ))}
      </div>
      <p className="nota">
        Puntos de corte de la Resolución 2254 de 2017 (MinAmbiente) sobre el promedio móvil de 24 horas,
        que es la misma tabla que publica el SIATA.
      </p>
    </section>
  );
}
