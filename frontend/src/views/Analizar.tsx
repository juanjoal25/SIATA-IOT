import { useCallback, useEffect, useState } from 'react';
import { analizarPunto, ApiError } from '../lib/api';
import { GeoError, obtenerPosicion, type Posicion } from '../lib/geolocation';
import { guardarUltimo, leerUltimo } from '../lib/pwa';
import type { RespuestaAire } from '../lib/types';
import { Resultado } from '../components/Resultado';
import { ComparadorMetodos } from '../components/ComparadorMetodos';
import { EstacionesCercanas } from '../components/EstacionesCercanas';
import { LeyendaIca } from '../components/LeyendaIca';

type Estado = 'inicial' | 'ubicando' | 'consultando' | 'listo' | 'error';

export function Analizar({ enLinea }: { enLinea: boolean }) {
  const [estado, setEstado] = useState<Estado>('inicial');
  const [error, setError] = useState<string | null>(null);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const [datos, setDatos] = useState<RespuestaAire | null>(null);
  const [metodo, setMetodo] = useState<string | null>(null);
  const [desdeCache, setDesdeCache] = useState<number | null>(null);

  // Al abrir sin red se muestra el último diagnóstico guardado en el dispositivo.
  useEffect(() => {
    if (datos) return;
    const ultimo = leerUltimo();
    if (ultimo) {
      setDatos(ultimo.respuesta);
      setMetodo(ultimo.respuesta.metodo);
      setDesdeCache(ultimo.guardado_en);
      setEstado('listo');
    }
  }, [datos]);

  /**
   * @param manual coordenadas escritas a mano; si no vienen, se pide el GPS.
   *   Sirve para verificar el sistema contra un punto conocido —por ejemplo la
   *   coordenada exacta de una estación, donde la distancia debe dar 0,00 km.
   */
  const analizar = useCallback(async (manual?: { latitud: number; longitud: number }) => {
    setError(null);
    setDesdeCache(null);
    setEstado(manual ? 'consultando' : 'ubicando');
    try {
      const pos = manual
        ? { ...manual, precision_m: null, timestamp: Date.now() }
        : await obtenerPosicion();
      setPosicion(pos);
      setEstado('consultando');

      const respuesta = await analizarPunto(pos.latitud, pos.longitud);
      setDatos(respuesta);
      setMetodo(respuesta.metodo);
      guardarUltimo(respuesta);
      setEstado('listo');
    } catch (fallo) {
      if (fallo instanceof GeoError) {
        setError(fallo.message);
      } else if (fallo instanceof ApiError) {
        setError(fallo.message);
        const ultimo = leerUltimo();
        if (fallo.code === 'sin_red' && ultimo) {
          setDatos(ultimo.respuesta);
          setMetodo(ultimo.respuesta.metodo);
          setDesdeCache(ultimo.guardado_en);
        }
      } else {
        setError('Ocurrió un error inesperado al analizar tu ubicación.');
      }
      setEstado('error');
    }
  }, []);

  // Acceso directo del manifest: /?accion=analizar dispara la medición al abrir.
  // También se admite ?lat=&lon= para compartir o verificar un punto concreto.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lat = Number(params.get('lat'));
    const lon = Number(params.get('lon'));
    if (Number.isFinite(lat) && Number.isFinite(lon) && params.has('lat')) {
      void analizar({ latitud: lat, longitud: lon });
    } else if (params.get('accion') === 'analizar') {
      void analizar();
    }
  }, [analizar]);

  const ocupado = estado === 'ubicando' || estado === 'consultando';
  const mostrado = datos && metodo && datos.comparacion[metodo]
    ? { ...datos, metodo, diagnostico: datos.comparacion[metodo]! }
    : datos;

  return (
    <>
      <section className="tarjeta hero">
        <h1>¿Cómo está el aire donde estás?</h1>
        <p>
          Cruzamos tu posición GPS con la malla interpolada de las 21 estaciones de PM2.5 del SIATA
          en el Valle de Aburrá.
        </p>
        <button className="boton-principal" onClick={() => void analizar()} disabled={ocupado}>
          {ocupado && <span className="girador" aria-hidden />}
          {estado === 'ubicando'
            ? 'Obteniendo tu ubicación…'
            : estado === 'consultando'
              ? 'Calculando el aire en tu punto…'
              : 'Analizar calidad del aire en mi ubicación'}
        </button>
        {posicion && (
          <p className="nota">
            {posicion.latitud.toFixed(5)}, {posicion.longitud.toFixed(5)}
            {posicion.precision_m !== null && ` · precisión ±${posicion.precision_m} m`}
          </p>
        )}

        <ProbadorCoordenadas onProbar={(lat, lon) => void analizar({ latitud: lat, longitud: lon })} />
      </section>

      {!enLinea && (
        <div className="aviso alerta">
          <span aria-hidden>⚠</span>
          <span>Estás sin conexión. La app funciona, pero los datos pueden no estar actualizados.</span>
        </div>
      )}

      {error && (
        <div className="aviso error">
          <span aria-hidden>✕</span>
          <span>{error}</span>
        </div>
      )}

      {mostrado && (
        <>
          <Resultado datos={mostrado} desdeCache={desdeCache} />

          {mostrado.advertencias?.map((aviso) => (
            <div className="aviso info" key={aviso}>
              <span aria-hidden>i</span>
              <span>{aviso}</span>
            </div>
          ))}

          <ComparadorMetodos
            comparacion={mostrado.comparacion}
            activo={metodo ?? mostrado.metodo}
            alElegir={setMetodo}
          />

          {mostrado.aporte_estaciones && (
            <section className="tarjeta">
              <h2>Peso de cada estación en la estimación</h2>
              <div className="leyenda">
                {mostrado.aporte_estaciones.map((a) => (
                  <div className="leyenda-fila" key={a.nombre_corto}>
                    <span className="muestra" style={{ background: 'var(--acento)', opacity: Math.max(0.2, a.peso) }} />
                    <span>{a.nombre_corto}</span>
                    <span className="rango">
                      {(a.peso * 100).toFixed(1)} % · {a.distancia_km.toFixed(2)} km
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <EstacionesCercanas estaciones={mostrado.estaciones_cercanas ?? []} />
          <LeyendaIca activo={mostrado.diagnostico.slug} />
        </>
      )}

      {!mostrado && !error && (
        <section className="tarjeta">
          <h2>Cómo funciona</h2>
          <p>
            1. El botón pide tu posición con la API de geolocalización del navegador; las coordenadas
            no salen de tu dispositivo más allá de la consulta.
          </p>
          <p>
            2. El backend cruza esas coordenadas con la malla que produce el ETL, que ya limpió,
            imputó e interpoló las series del SIATA.
          </p>
          <p>
            3. La concentración estimada se convierte a ICA y se traduce al semáforo de seis colores
            de la norma colombiana.
          </p>
          <LeyendaIca />
        </section>
      )}
    </>
  );
}

/**
 * Consulta de un punto escrito a mano.
 *
 * Es la herramienta de verificación del sistema: al meter la coordenada exacta
 * de una estación, la respuesta debe decir que esa estación está a 0,00 km y el
 * valor debe parecerse al que midió. Si eso cuadra, el cruce entre GPS, malla y
 * red de estaciones está bien alineado.
 */
function ProbadorCoordenadas({ onProbar }: { onProbar: (lat: number, lon: number) => void }) {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const valido = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && lat !== '' && lon !== '';

  return (
    <details className="detalle-tecnico" style={{ marginTop: 18, textAlign: 'left' }}>
      <summary>Consultar una coordenada concreta</summary>
      <form
        className="probador"
        onSubmit={(evento) => {
          evento.preventDefault();
          if (valido) onProbar(Number(lat), Number(lon));
        }}
      >
        <input
          inputMode="decimal"
          placeholder="Latitud (6.1555)"
          value={lat}
          onChange={(e) => setLat(e.target.value.trim())}
          aria-label="Latitud"
        />
        <input
          inputMode="decimal"
          placeholder="Longitud (-75.6442)"
          value={lon}
          onChange={(e) => setLon(e.target.value.trim())}
          aria-label="Longitud"
        />
        <button type="submit" className="boton-secundario" disabled={!valido}>
          Consultar
        </button>
      </form>
      <p className="nota">
        Útil para verificar el sistema: si escribes la coordenada exacta de una estación, el
        resultado debe indicarla a 0,00 km. Por ejemplo{' '}
        <button
          type="button"
          className="enlace-boton"
          onClick={() => {
            setLat('6.1555305');
            setLon('-75.6441727');
            onProbar(6.1555305, -75.6441727);
          }}
        >
          La Estrella – Hospital (EST-HOSP)
        </button>
        .
      </p>
    </details>
  );
}
