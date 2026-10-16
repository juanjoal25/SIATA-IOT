import { useEffect, useMemo, useRef } from 'react';
import type { CampoMalla, Estacion, TramoEscala } from '../lib/types';

/**
 * Pinta el campo interpolado como mapa de calor en un canvas.
 *
 * Cada píxel es una celda de la malla coloreada con el semáforo del ICA, así
 * que el mapa y el diagnóstico del usuario hablan el mismo idioma. La fila 0
 * del artefacto es `lat_min`, que en pantalla va abajo: de ahí la inversión
 * del eje Y.
 */
export function MapaMalla({
  campo,
  escala,
  estaciones = [],
  punto,
}: {
  campo: CampoMalla;
  escala: TramoEscala[];
  estaciones?: Estacion[];
  punto?: { latitud: number; longitud: number } | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  // Rango propio del campo: en una hora tranquila todo el valle cae en la misma
  // banda del ICA y el mapa saldría plano. El tono lo da el semáforo
  // (coherencia con el diagnóstico) y la luminosidad, la posición dentro de
  // este rango, que es lo que deja ver la estructura espacial.
  const [vMin, vMax] = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const v of campo.valores) {
      if (v === null || v === undefined) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return Number.isFinite(min) ? [min, max] : [0, 1];
  }, [campo.valores]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || escala.length === 0) return;
    const { nrows, ncols, lat_min, lat_max, lon_min, lon_max } = campo.malla;

    const escalaPx = Math.max(1, Math.floor(700 / ncols));
    canvas.width = ncols * escalaPx;
    canvas.height = nrows * escalaPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imagen = ctx.createImageData(ncols, nrows);
    for (let i = 0; i < nrows; i += 1) {
      for (let j = 0; j < ncols; j += 1) {
        const valor = campo.valores[i * ncols + j];
        const destino = ((nrows - 1 - i) * ncols + j) * 4; // eje Y invertido
        if (valor === null || valor === undefined) {
          imagen.data[destino] = 22;
          imagen.data[destino + 1] = 30;
          imagen.data[destino + 2] = 61;
          imagen.data[destino + 3] = 255;
          continue;
        }
        const [r, g, b] = modular(rgbDeIca(valor, escala), valor, vMin, vMax);
        imagen.data[destino] = r;
        imagen.data[destino + 1] = g;
        imagen.data[destino + 2] = b;
        imagen.data[destino + 3] = 255;
      }
    }

    // Se dibuja a tamaño 1:1 y se escala sin suavizado para ver la resolución real.
    const buffer = document.createElement('canvas');
    buffer.width = ncols;
    buffer.height = nrows;
    buffer.getContext('2d')?.putImageData(imagen, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

    const aPixel = (lat: number, lon: number) => ({
      x: ((lon - lon_min) / (lon_max - lon_min)) * canvas.width,
      y: canvas.height - ((lat - lat_min) / (lat_max - lat_min)) * canvas.height,
    });

    for (const est of estaciones) {
      const { x, y } = aPixel(est.latitud, est.longitud);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(11,16,32,0.9)';
      ctx.stroke();
    }

    if (punto) {
      const { x, y } = aPixel(punto.latitud, punto.longitud);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#5b8cff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }, [campo, escala, estaciones, punto, vMin, vMax]);

  return (
    <>
      <canvas ref={ref} className="mapa-malla" role="img" aria-label={`Mapa interpolado (${campo.metodo})`} />
      <p className="nota">
        Malla {campo.malla.nrows} × {campo.malla.ncols} celdas · resolución{' '}
        {(campo.malla.resolucion_deg * 111).toFixed(2)} km · método {campo.metodo}
        {campo.paso > 1 && ` · submuestreada 1:${campo.paso} para el envío`}. Los puntos blancos son
        las estaciones reales del SIATA.
      </p>
      <p className="nota">
        El campo va de <strong>{vMin.toFixed(1)}</strong> a <strong>{vMax.toFixed(1)} µg/m³</strong>. El
        tono es la categoría del ICA; dentro de una misma categoría, las zonas más claras están más
        limpias y las más oscuras, más cargadas.
      </p>
    </>
  );
}

/** Color del semáforo con interpolación suave dentro de cada tramo. */
function rgbDeIca(valor: number, escala: TramoEscala[]): [number, number, number] {
  const tramo = escala.find((t) => valor <= t.pm25_max) ?? escala[escala.length - 1]!;
  const indice = escala.indexOf(tramo);
  const anterior = indice > 0 ? escala[indice - 1]! : null;
  const base = hexARgb(tramo.hex);
  if (!anterior) return base;

  const t = Math.min(1, Math.max(0, (valor - tramo.pm25_min) / (tramo.pm25_max - tramo.pm25_min)));
  const previo = hexARgb(anterior.hex);
  // Mezcla en el primer tercio del tramo para que la frontera no sea un escalón duro.
  const mezcla = Math.min(1, t / 0.35);
  return [
    Math.round(previo[0] + (base[0] - previo[0]) * mezcla),
    Math.round(previo[1] + (base[1] - previo[1]) * mezcla),
    Math.round(previo[2] + (base[2] - previo[2]) * mezcla),
  ];
}

/**
 * Aclara los valores bajos y oscurece los altos dentro del rango del propio
 * campo, sin cambiar el tono: el color sigue diciendo «Moderada», la
 * luminosidad dice «aquí dentro de Moderada estás arriba o abajo».
 */
function modular(
  [r, g, b]: [number, number, number],
  valor: number,
  vMin: number,
  vMax: number,
): [number, number, number] {
  if (vMax - vMin < 1e-6) return [r, g, b];
  const t = (valor - vMin) / (vMax - vMin); // 0 = el más limpio, 1 = el más cargado
  const factor = 1.3 - 0.6 * t;
  const hacia = t < 0.5 ? 255 : 0; // mezcla hacia blanco o hacia negro
  const peso = Math.abs(factor - 1);
  return [
    Math.round(Math.min(255, r * (1 - peso) + hacia * peso)),
    Math.round(Math.min(255, g * (1 - peso) + hacia * peso)),
    Math.round(Math.min(255, b * (1 - peso) + hacia * peso)),
  ];
}

function hexARgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
