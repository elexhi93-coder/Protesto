/**
 * Generates the ProtestGuard PWA icons (pure Node, zero dependencies).
 * Produces proper PNG files so "Add to Home Screen" works on Android & iOS.
 * Run: node scripts/generate-icons.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- PNG encoder (RGBA, 8-bit) ----
let crcTable;
function makeCrcTable() {
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
}
function crc32(buf) {
  if (!crcTable) makeCrcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Shield drawing ----
function makeShield(scale) {
  const pts = [
    [0.50, 0.08],
    [0.16, 0.20],
    [0.16, 0.52],
    [0.32, 0.60],
    [0.32, 0.78],
    [0.50, 0.92],
    [0.68, 0.78],
    [0.68, 0.60],
    [0.84, 0.52],
    [0.84, 0.20]
  ];
  return pts.map(([x, y]) => [0.5 + (x - 0.5) * scale, 0.5 + (y - 0.5) * scale]);
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function drawIcon(size, opts) {
  const bg = opts.bg || [18, 20, 23];        // #121417
  const fill = opts.fill || [230, 57, 70];   // #e63946
  const border = opts.border || [248, 249, 250]; // #f8f9fa
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size * 4; i += 4) {
    rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = 255;
  }
  const setPx = (x, y, color) => {
    const i = (y * size + x) * 4;
    rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = 255;
  };
  const outer = makeShield(opts.outerScale || 1.0);
  const inner = makeShield(opts.innerScale || 0.80);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size, fy = (y + 0.5) / size;
      if (pointInPoly(fx, fy, outer)) setPx(x, y, border);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size, fy = (y + 0.5) / size;
      if (pointInPoly(fx, fy, inner)) setPx(x, y, fill);
    }
  }
  return encodePNG(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  { name: 'icon-192.png', size: 192, outer: 1.0, inner: 0.80 },
  { name: 'icon-512.png', size: 512, outer: 1.0, inner: 0.80 },
  { name: 'icon-512-maskable.png', size: 512, outer: 0.72, inner: 0.58 },
  { name: 'apple-touch-icon.png', size: 180, outer: 1.0, inner: 0.80 }
];

for (const f of files) {
  const png = drawIcon(f.size, { outerScale: f.outer, innerScale: f.inner });
  fs.writeFileSync(path.join(outDir, f.name), png);
  console.log('Wrote', f.name, png.length, 'bytes');
}
console.log('Done. Icons written to', outDir);
