/**
 * Muestreo de la malla interpolada que publica el ETL.
 *
 * La malla llega como un arreglo plano en orden row-major (fila 0 = `lat_min`,
 * columna 0 = `lon_min`). Cruzar la coordenada del usuario con ella es una
 * interpolación bilineal entre las cuatro celdas que lo rodean — el mismo
 * cálculo que `etl/interpolate.py::sample_point`, para que backend y ETL nunca
 * discrepen.
 */

/** Índice plano de la celda (i, j). */
const at = (malla, valores, i, j) => valores[i * malla.ncols + j];

/**
 * @param {object} grid  artefacto `grid.json`
 * @param {string} campo `pm25_24h` | `pm25_1h`
 * @param {string} metodo `linear` | `cubic` | `nearest`
 * @param {number} lat
 * @param {number} lon
 * @returns {{valor: number|null, extrapolado: boolean, celda: {i:number,j:number}|null, fuera_de_malla: boolean}}
 */
export function sample(grid, campo, metodo, lat, lon) {
  const malla = grid.malla;
  const valores = grid.campos?.[campo]?.[metodo];
  if (!valores) {
    throw new Error(`La malla no tiene el campo "${campo}" con el método "${metodo}".`);
  }

  const dLat = (malla.lat_max - malla.lat_min) / (malla.nrows - 1);
  const dLon = (malla.lon_max - malla.lon_min) / (malla.ncols - 1);

  if (lat < malla.lat_min || lat > malla.lat_max || lon < malla.lon_min || lon > malla.lon_max) {
    return { valor: null, extrapolado: true, celda: null, fuera_de_malla: true };
  }

  const fi = (lat - malla.lat_min) / dLat;
  const fj = (lon - malla.lon_min) / dLon;
  const i0 = Math.min(Math.floor(fi), malla.nrows - 1);
  const j0 = Math.min(Math.floor(fj), malla.ncols - 1);
  const i1 = Math.min(i0 + 1, malla.nrows - 1);
  const j1 = Math.min(j0 + 1, malla.ncols - 1);
  const di = fi - i0;
  const dj = fj - j0;

  const esquinas = [
    { v: at(malla, valores, i0, j0), w: (1 - di) * (1 - dj) },
    { v: at(malla, valores, i1, j0), w: di * (1 - dj) },
    { v: at(malla, valores, i0, j1), w: (1 - di) * dj },
    { v: at(malla, valores, i1, j1), w: di * dj },
  ];

  // Si alguna esquina es nula (hueco de la interpolación), se renormaliza con
  // las que sí tienen dato en lugar de devolver null por una sola ausencia.
  let suma = 0;
  let peso = 0;
  for (const { v, w } of esquinas) {
    if (v === null || v === undefined) continue;
    suma += v * w;
    peso += w;
  }

  const celdaMasCercana = {
    i: di < 0.5 ? i0 : i1,
    j: dj < 0.5 ? j0 : j1,
  };
  const extrapolado = Boolean(
    grid.extrapolado?.[celdaMasCercana.i * malla.ncols + celdaMasCercana.j],
  );

  if (peso === 0) {
    return { valor: null, extrapolado, celda: celdaMasCercana, fuera_de_malla: false };
  }
  return {
    valor: Math.round((suma / peso) * 100) / 100,
    extrapolado,
    celda: celdaMasCercana,
    fuera_de_malla: false,
  };
}

/**
 * Devuelve el campo completo listo para pintar, opcionalmente submuestreado
 * para no mandar 8.000 celdas a un móvil.
 */
export function field(grid, campo, metodo, { maxCells = 0 } = {}) {
  const malla = grid.malla;
  const valores = grid.campos?.[campo]?.[metodo];
  if (!valores) throw new Error(`Campo "${campo}" / método "${metodo}" inexistente.`);

  let paso = 1;
  if (maxCells > 0 && malla.nrows * malla.ncols > maxCells) {
    paso = Math.ceil(Math.sqrt((malla.nrows * malla.ncols) / maxCells));
  }
  if (paso === 1) {
    return { malla, metodo, campo, paso, valores };
  }

  const filas = [];
  const salida = [];
  for (let i = 0; i < malla.nrows; i += paso) filas.push(i);
  const columnas = [];
  for (let j = 0; j < malla.ncols; j += paso) columnas.push(j);
  for (const i of filas) {
    for (const j of columnas) salida.push(at(malla, valores, i, j));
  }
  return {
    malla: {
      ...malla,
      nrows: filas.length,
      ncols: columnas.length,
      lat_max: malla.lat_min + filas[filas.length - 1] * ((malla.lat_max - malla.lat_min) / (malla.nrows - 1)),
      lon_max: malla.lon_min + columnas[columnas.length - 1] * ((malla.lon_max - malla.lon_min) / (malla.ncols - 1)),
      resolucion_deg: malla.resolucion_deg * paso,
    },
    metodo,
    campo,
    paso,
    valores: salida,
  };
}
