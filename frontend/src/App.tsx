import { lazy, Suspense, useEffect, useState } from 'react';
import { Analizar } from './views/Analizar';
import { observarConexion } from './lib/pwa';

// «Mi ubicación» es lo que abre el 95 % de la gente y no necesita gráficas.
// Las dos vistas analíticas —y con ellas Recharts, que pesa ~130 kB gzip— se
// descargan solo si alguien entra a verlas: la pantalla principal queda en
// ~78 kB en lugar de ~208 kB.
const Analisis = lazy(() => import('./views/Analisis').then((m) => ({ default: m.Analisis })));
const ProcesoEtl = lazy(() => import('./views/ProcesoEtl').then((m) => ({ default: m.ProcesoEtl })));

type Vista = 'analizar' | 'analisis' | 'etl';

const VISTAS: { id: Vista; titulo: string }[] = [
  { id: 'analizar', titulo: 'Mi ubicación' },
  { id: 'analisis', titulo: 'Análisis' },
  { id: 'etl', titulo: 'Proceso ETL' },
];

export function App() {
  const [vista, setVista] = useState<Vista>(() => {
    const pedida = new URLSearchParams(window.location.search).get('vista');
    return VISTAS.some((v) => v.id === pedida) ? (pedida as Vista) : 'analizar';
  });
  const [enLinea, setEnLinea] = useState(() => navigator.onLine);

  useEffect(() => observarConexion(setEnLinea), []);

  // La vista se refleja en la URL para que se pueda compartir y volver atrás.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (vista === 'analizar') url.searchParams.delete('vista');
    else url.searchParams.set('vista', vista);
    window.history.replaceState(null, '', url);
  }, [vista]);

  return (
    <>
      <header className="cabecera">
        <div className="marca">
          <img src="/icons/icon-192.png" alt="" width={34} height={34} />
          <div>
            <strong>Aire Valle de Aburrá</strong>
            <span>PM2.5 · datos abiertos del SIATA</span>
          </div>
        </div>
        <nav className="pestanas" role="tablist" aria-label="Secciones">
          {VISTAS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={vista === item.id}
              onClick={() => setVista(item.id)}
            >
              {item.titulo}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {vista === 'analizar' && <Analizar enLinea={enLinea} />}
        {vista !== 'analizar' && (
          <Suspense fallback={<Cargando />}>
            {vista === 'analisis' && <Analisis />}
            {vista === 'etl' && <ProcesoEtl />}
          </Suspense>
        )}
      </main>

      <footer className="pie-pagina">
        Datos: Sistema de Alerta Temprana del Valle de Aburrá (SIATA) · Semáforo según la Resolución
        2254 de 2017.
        <br />
        Esta aplicación es una estimación interpolada y no sustituye los boletines oficiales del AMVA.
      </footer>
    </>
  );
}

/** Se muestra mientras baja el paquete de gráficas. */
function Cargando() {
  return (
    <section className="tarjeta">
      <div className="leyenda">
        {[85, 65, 75].map((ancho) => (
          <div key={ancho} className="esqueleto" style={{ width: `${ancho}%` }} />
        ))}
      </div>
    </section>
  );
}
