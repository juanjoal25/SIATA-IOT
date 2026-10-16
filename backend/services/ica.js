/**
 * Semáforo del ICA para PM2.5.
 *
 * La tabla de referencia la publica el ETL en `ica_scale.json` (una sola
 * fuente de verdad, definida en `etl/config.py`). La constante de abajo es el
 * respaldo para cuando el ETL todavía no ha corrido.
 */
import { get } from './artifacts.js';

/** Espejo de ICA_BREAKPOINTS en etl/config.py — Resolución 2254 de 2017. */
const ESCALA_FALLBACK = [
  { slug: 'verde', categoria: 'Buena', color: 'Verde', hex: '#00e400', pm25_min: 0, pm25_max: 12, ica_min: 0, ica_max: 50,
    recomendacion: 'La calidad del aire es satisfactoria. Puedes hacer actividades al aire libre sin restricción.' },
  { slug: 'amarillo', categoria: 'Moderada', color: 'Amarillo', hex: '#ffff00', pm25_min: 12.1, pm25_max: 37, ica_min: 51, ica_max: 100,
    recomendacion: 'Aceptable. Personas inusualmente sensibles deberían considerar reducir el esfuerzo prolongado al aire libre.' },
  { slug: 'naranja', categoria: 'Dañina a grupos sensibles', color: 'Naranja', hex: '#ff7e00', pm25_min: 37.1, pm25_max: 55, ica_min: 101, ica_max: 150,
    recomendacion: 'Niños, adultos mayores y personas con asma o enfermedad cardiaca deben limitar el esfuerzo al aire libre.' },
  { slug: 'rojo', categoria: 'Dañina a la salud', color: 'Rojo', hex: '#ff0000', pm25_min: 55.1, pm25_max: 150, ica_min: 151, ica_max: 200,
    recomendacion: 'Toda la población puede sentir efectos. Evita el ejercicio prolongado al aire libre y usa tapabocas.' },
  { slug: 'purpura', categoria: 'Muy dañina a la salud', color: 'Púrpura', hex: '#8f3f97', pm25_min: 150.1, pm25_max: 250, ica_min: 201, ica_max: 300,
    recomendacion: 'Alerta sanitaria: el riesgo es alto para todos. Permanece en interiores con ventanas cerradas.' },
  { slug: 'marron', categoria: 'Peligrosa', color: 'Marrón', hex: '#7e0023', pm25_min: 250.1, pm25_max: 500, ica_min: 301, ica_max: 500,
    recomendacion: 'Emergencia sanitaria. Evita cualquier actividad al aire libre y atiende las instrucciones del AMVA.' },
];

const SIN_DATO = {
  pm25: null, ica: null, categoria: 'Sin dato', color: 'Gris', slug: 'sin-dato', hex: '#6b7280',
  recomendacion: 'No hay suficientes datos válidos para emitir un diagnóstico en este punto.',
};

export async function escala() {
  const artefacto = await get('icaScale');
  return artefacto?.escala ?? ESCALA_FALLBACK;
}

/** La norma exige truncar la concentración a un decimal antes de indexar. */
const truncar = (c) => Math.floor(Math.round(c * 10000) / 1000) / 10;

/**
 * Convierte µg/m³ de PM2.5 en el diagnóstico completo del semáforo.
 * @param {number|null} concentracion
 */
export async function clasificar(concentracion) {
  if (concentracion === null || concentracion === undefined || !Number.isFinite(concentracion)) {
    return { ...SIN_DATO };
  }
  const tabla = await escala();
  const c = truncar(Math.max(concentracion, 0));
  const tramo = tabla.find((t) => c <= t.pm25_max) ?? tabla[tabla.length - 1];
  const ica =
    c > tabla[tabla.length - 1].pm25_max
      ? 500
      : Math.round(
          (((tramo.ica_max - tramo.ica_min) / (tramo.pm25_max - tramo.pm25_min)) * (c - tramo.pm25_min) +
            tramo.ica_min) * 10,
        ) / 10;

  return {
    pm25: Math.round(concentracion * 100) / 100,
    ica,
    categoria: tramo.categoria,
    color: tramo.color,
    slug: tramo.slug,
    hex: tramo.hex,
    recomendacion: tramo.recomendacion,
  };
}
