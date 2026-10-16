/**
 * Genera los iconos PNG de la PWA sin dependencias: encoder PNG mínimo sobre
 * `zlib`. El dibujo es el semáforo del ICA como anillo concéntrico.
 *
 *   npm run icons
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'public', 'icons');

const FONDO = [11, 16, 32];
const ANILLO = [
  [0x00, 0xe4, 0x00], // verde
  [0xff, 0xff, 0x00], // amarillo
  [0xff, 0x7e, 0x00], // naranja
  [0xff, 0x00, 0x00], // rojo
  [0x8f, 0x3f, 0x97], // púrpura
  [0x7e, 0x00, 0x23], // marrón
];

/** CRC32 de la especificación PNG. */
const TABLA_CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (tipo, datos) => {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
};

/** RGBA sin filtro (tipo 0 por scanline) -> PNG. */
function encodePng(width, height, rgba) {
  const filas = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    filas[y * (width * 4 + 1)] = 0;
    rgba.copy(filas, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // color RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(filas, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function dibujar(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const escala = maskable ? 0.62 : 0.86; // zona segura del icono maskable
  const rExterno = (size / 2) * escala;
  const rInterno = rExterno * 0.56;
  const grosor = rExterno - rInterno;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      const i = (y * size + x) * 4;

      // Fondo: degradado radial sutil.
      const t = Math.min(1, r / (size / 2));
      let [cr, cg, cb] = FONDO.map((v, k) => Math.round(v + (k === 2 ? 26 : 10) * (1 - t)));
      let alfa = 255;

      if (r <= rExterno && r >= rInterno) {
        // Ángulo -> tramo del semáforo, empezando arriba y en sentido horario.
        const ang = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
        const idx = Math.min(ANILLO.length - 1, Math.floor((ang / (Math.PI * 2)) * ANILLO.length));
        [cr, cg, cb] = ANILLO[idx];
        // Antialias en los bordes del anillo.
        const borde = Math.min(r - rInterno, rExterno - r);
        if (borde < 1.5) {
          const mezcla = borde / 1.5;
          cr = Math.round(cr * mezcla + FONDO[0] * (1 - mezcla));
          cg = Math.round(cg * mezcla + FONDO[1] * (1 - mezcla));
          cb = Math.round(cb * mezcla + FONDO[2] * (1 - mezcla));
        }
      } else if (r < rInterno) {
        // Punto central: el «estás aquí».
        const rPunto = grosor * 0.55;
        if (r < rPunto) {
          const mezcla = Math.min(1, (rPunto - r) / 1.5);
          cr = Math.round(0xf8 * mezcla + cr * (1 - mezcla));
          cg = Math.round(0xfa * mezcla + cg * (1 - mezcla));
          cb = Math.round(0xff * mezcla + cb * (1 - mezcla));
        }
      }

      if (!maskable && r > size / 2 - 0.5) alfa = 0; // icono circular
      rgba[i] = cr;
      rgba[i + 1] = cg;
      rgba[i + 2] = cb;
      rgba[i + 3] = alfa;
    }
  }
  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT, { recursive: true });
const salidas = [
  ['icon-192.png', dibujar(192)],
  ['icon-512.png', dibujar(512)],
  ['maskable-512.png', dibujar(512, { maskable: true })],
  ['favicon-64.png', dibujar(64)],
];
for (const [nombre, buffer] of salidas) {
  fs.writeFileSync(path.join(OUT, nombre), buffer);
  console.log(`  ${nombre}  ${(buffer.length / 1024).toFixed(1)} KB`);
}
console.log(`Iconos escritos en ${OUT}`);
