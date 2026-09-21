// Genera los iconos PNG de la PWA sin dependencias (codificador PNG propio con zlib de Node).
// Dibuja un camión sobre fondo ámbar por muestreo 3×3 (suavizado de bordes).
//   node scripts/generate-icons.mjs        (o: npm run icons)
// Para cambiar el diseño, edita `glyph()` y vuelve a ejecutarlo; también hay un favicon.svg equivalente.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const AMBER = [245, 158, 11];
const SLATE = [15, 23, 42];

const inRect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
const inCircle = (u, v, cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;

/** Camión en coordenadas de 0 a 1. Devuelve 'fg' (oscuro), 'bg' (hueco) o null (fuera). */
function glyph(u, v) {
  const hub = inCircle(u, v, 0.27, 0.68, 0.03) || inCircle(u, v, 0.74, 0.68, 0.03);
  const window = inRect(u, v, 0.66, 0.44, 0.76, 0.52);
  if (hub || window) return 'bg';
  const body =
    inRect(u, v, 0.1, 0.3, 0.58, 0.64) || // caja
    inRect(u, v, 0.6, 0.4, 0.77, 0.64) || // cabina
    (v >= 0.4 && v <= 0.64 && u > 0.77 && u <= 0.88 && u - 0.77 <= (0.64 - v) * 0.92) || // capó inclinado
    inCircle(u, v, 0.27, 0.68, 0.075) ||
    inCircle(u, v, 0.74, 0.68, 0.075);
  return body ? 'fg' : null;
}

function roundedMask(u, v, radius) {
  const dx = Math.max(radius - u, u - (1 - radius), 0);
  const dy = Math.max(radius - v, v - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** size px, glyphScale = tamaño del dibujo respecto al lienzo, rounded = esquinas redondeadas transparentes */
function render(size, { glyphScale, rounded }) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 3;
  const cx = 0.49; // centro del dibujo
  const cy = 0.5275;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (rounded && !roundedMask(u, v, 0.19)) continue;
          const part = glyph((u - 0.5) / glyphScale + cx, (v - 0.5) / glyphScale + cy);
          const c = part === 'fg' ? SLATE : AMBER;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const covered = a / 255; // muestras opacas
      const i = (y * size + x) * 4;
      px[i] = covered ? Math.round(r / covered) : 0;
      px[i + 1] = covered ? Math.round(g / covered) : 0;
      px[i + 2] = covered ? Math.round(b / covered) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

// --- Codificador PNG mínimo (RGBA, 8 bits) ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // filtro "None"
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, { glyphScale: 0.84, rounded: true }],
  ['icon-512.png', 512, { glyphScale: 0.84, rounded: true }],
  // Maskable: sin esquinas y con el dibujo dentro de la "zona segura" central (80 %).
  ['icon-maskable-512.png', 512, { glyphScale: 0.66, rounded: false }],
  // iOS aplica su propia máscara y no admite transparencia.
  ['apple-touch-icon.png', 180, { glyphScale: 0.8, rounded: false }],
];
for (const [name, size, opts] of targets) {
  writeFileSync(new URL(name, outDir), encodePng(size, render(size, opts)));
  console.log(`✔ public/icons/${name}`);
}
