const fs = require('node:fs');
const zlib = require('node:zlib');

function png(size, transparent) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const i = 1 + x * 4;
      const margin = size * 0.08;
      const radius = size * 0.19;
      const cx = Math.max(margin + radius, Math.min(size - margin - radius, x));
      const cy = Math.max(margin + radius, Math.min(size - margin - radius, y));
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
      const sx = x / size;
      const sy = y / size;
      const inArrow = (sx > 0.32 && sx < 0.43 && sy > 0.25 && sy < 0.75) ||
        (sx >= 0.39 && sx <= 0.68 && Math.abs(sy - (0.5 + (sx - 0.39) * 0.92)) < 0.065) ||
        (sx >= 0.39 && sx <= 0.68 && Math.abs(sy - (0.5 - (sx - 0.39) * 0.92)) < 0.065);
      if (inArrow && (transparent || inside)) {
        row[i] = row[i + 1] = row[i + 2] = 255;
        row[i + 3] = 255;
      } else if (!transparent && inside) {
        const t = (x + y) / (size * 2);
        row[i] = Math.round(104 + 63 * t);
        row[i + 1] = Math.round(95 - 9 * t);
        row[i + 2] = Math.round(244 - 12 * t);
        row[i + 3] = 255;
      }
    }
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([n, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const dir = __dirname;
fs.writeFileSync(`${dir}/flux-icon.png`, png(512, false));
fs.writeFileSync(`${dir}/flux-foreground.png`, png(512, true));
