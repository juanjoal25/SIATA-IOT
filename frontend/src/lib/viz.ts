/**
 * Tokens de visualización.
 *
 * Todas las paletas de aquí se validaron contra la superficie real de las
 * tarjetas (`#161f3d`) con el verificador de contraste/CVD, no a ojo:
 *
 * - **Categórica** `#3987e5` / `#d95926` — pasa las seis comprobaciones
 *   (ΔE CVD 26,8 · normal 31,8 · contraste ≥ 3:1).
 * - **Secuencial ámbar** de 7 pasos — un solo tono (dispersión 5°), luminosidad
 *   monótona, el extremo oscuro a 2,02:1 de la superficie.
 * - **Semáforo del ICA** — *no* es una paleta de diseño: la fija la Resolución
 *   2254 de 2017 y no se puede recolorear. Falla la banda de luminosidad y el
 *   púrpura/marrón quedan por debajo de 3:1 contra el fondo, así que **toda**
 *   gráfica que la use lleva etiquetas visibles y una vista de tabla; el color
 *   nunca carga solo con el significado. La separación entre bandas contiguas
 *   sí pasa (ΔE 9,6), que es lo crítico para leerlas.
 *
 * El verde y el rojo de «sano vs. descartado» se descartaron a propósito: ese
 * par mide ΔE 4,1 en deuteranopía, la confusión más común. Se usa la
 * categórica azul/naranja.
 */

/** Par categórico validado: identidad de dos series. */
export const SERIE = {
  uno: '#3987e5',
  dos: '#d95926',
} as const;

/** Rampa secuencial de un solo tono para magnitud (mapa de calor). */
export const RAMPA_AMBAR = [
  '#6b4a18',
  '#8a5f1c',
  '#a87421',
  '#c68a27',
  '#dda23a',
  '#efbb62',
  '#ffd48f',
] as const;

/** Tinta y cromo de las gráficas (espejo de los tokens de styles.css). */
export const TINTA = {
  primaria: '#eef2ff',
  secundaria: '#a5b0d8',
  apagada: '#7b87b5',
  rejilla: '#2a3766',
  eje: '#3a4a80',
  superficie: '#161f3d',
  superficieAlt: '#1d2950',
} as const;

/** Orden de gravedad del semáforo. Nunca se reordena. */
export const ORDEN_ICA = ['verde', 'amarillo', 'naranja', 'rojo', 'purpura', 'marron'] as const;
export type SlugIca = (typeof ORDEN_ICA)[number];

export const HEX_ICA: Record<SlugIca, string> = {
  verde: '#00e400',
  amarillo: '#ffff00',
  naranja: '#ff7e00',
  rojo: '#ff0000',
  purpura: '#8f3f97',
  marron: '#7e0023',
};

export const NOMBRE_ICA: Record<SlugIca, string> = {
  verde: 'Buena',
  amarillo: 'Moderada',
  naranja: 'Dañina a grupos sensibles',
  rojo: 'Dañina a la salud',
  purpura: 'Muy dañina',
  marron: 'Peligrosa',
};

/** Texto legible sobre un color de relleno (el amarillo pide tinta oscura). */
export function tintaSobre(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const luminancia = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminancia > 0.6 ? '#0b1020' : '#ffffff';
}

/** Paso de la rampa ámbar que corresponde a un valor dentro de [min, max]. */
export function pasoRampa(valor: number | null, min: number, max: number): string {
  if (valor === null || !Number.isFinite(valor)) return TINTA.superficieAlt;
  if (max - min < 1e-9) return RAMPA_AMBAR[RAMPA_AMBAR.length - 1]!;
  const t = Math.min(1, Math.max(0, (valor - min) / (max - min)));
  return RAMPA_AMBAR[Math.min(RAMPA_AMBAR.length - 1, Math.round(t * (RAMPA_AMBAR.length - 1)))]!;
}

/** Categoría del ICA para una concentración de PM2.5 (24 h). */
export function categoriaDe(valor: number): SlugIca {
  if (valor <= 12) return 'verde';
  if (valor <= 37) return 'amarillo';
  if (valor <= 55) return 'naranja';
  if (valor <= 150) return 'rojo';
  if (valor <= 250) return 'purpura';
  return 'marron';
}

/** Ejes y rejilla compartidos por todas las gráficas de Recharts. */
export const EJE = {
  tick: { fill: TINTA.apagada, fontSize: 11 },
  axisLine: { stroke: TINTA.eje },
  tickLine: { stroke: TINTA.eje },
} as const;

export const formatoNumero = (n: number | null | undefined, nd = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(nd);

export const formatoPct = (n: number | null | undefined, nd = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${n.toFixed(nd)} %`;
