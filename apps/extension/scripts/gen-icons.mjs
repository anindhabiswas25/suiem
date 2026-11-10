// Draws the Suiem mark (ring + smile on navy) as PNG icons. No external assets, no brand marks.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [11, 20, 38],
    fg = [122, 167, 255];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size - 0.5,
        ny = (y + 0.5) / size - 0.5;
      const r = Math.hypot(nx, ny);
      const corner = Math.max(Math.abs(nx), Math.abs(ny)) > 0.5 - 0.02;
      let color = bg,
        alpha = corner && r > 0.62 ? 0 : 255;
      const ringW = Math.max(0.07, 1.6 / size);
      if (Math.abs(r - 0.34) < ringW / 2) color = fg;
      // smile: lower arc
      const sr = Math.hypot(nx, ny + 0.02);
      if (ny > 0.02 && Math.abs(sr - 0.18) < ringW / 2 && Math.abs(nx) < 0.16) color = fg;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = color[0];
      raw[i + 1] = color[1];
      raw[i + 2] = color[2];
      raw[i + 3] = alpha;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const s of [16, 32, 48, 128])
  writeFileSync(new URL(`../public/icon/${s}.png`, import.meta.url), png(s));
console.log("icons written");
