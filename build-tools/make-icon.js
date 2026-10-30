// Gera assets/icon.ico (PNG 256x256 embutido em ICO) sem dependências externas
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = Buffer.alloc(S * S * 4);
const set = (x, y, [r, g, b, a]) => {
  const i = (y * S + x) * 4;
  const A = a / 255, B = px[i + 3] / 255, out = A + B * (1 - A);
  if (!out) return;
  px[i]     = (r * A + px[i]     * B * (1 - A)) / out;
  px[i + 1] = (g * A + px[i + 1] * B * (1 - A)) / out;
  px[i + 2] = (b * A + px[i + 2] * B * (1 - A)) / out;
  px[i + 3] = out * 255;
};
const cov = d => Math.max(0, Math.min(1, 0.5 - d)); // anti-aliasing simples

const c = S / 2;
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
  // fundo: quadrado arredondado escuro
  const q = Math.max(Math.abs(dx), Math.abs(dy)) - 104;
  const rr = Math.hypot(Math.max(Math.abs(dx) - 80, 0), Math.max(Math.abs(dy) - 80, 0)) - 44;
  const bg = cov(Math.max(q, rr));
  if (bg) set(x, y, [20, 20, 26, 255 * bg]);
  // anel ciano
  const ring = cov(Math.abs(r - 70) - 8);
  if (ring) set(x, y, [0, 229, 255, 255 * ring]);
  // mira (cruz) com intervalo no centro
  const arm = (Math.abs(dx) < 6 && Math.abs(dy) > 24 && Math.abs(dy) < 100)
           || (Math.abs(dy) < 6 && Math.abs(dx) > 24 && Math.abs(dx) < 100);
  if (arm) set(x, y, [0, 229, 255, 255]);
  // ponto central rosa
  const dot = cov(r - 14);
  if (dot) set(x, y, [255, 61, 113, 255 * dot]);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header[6] = 0; header[7] = 0; // 0 = 256px
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);

const out = path.join(__dirname, '..', 'assets');
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, png]));
fs.writeFileSync(path.join(out, 'icon.png'), png);
console.log('assets/icon.ico gerado');
