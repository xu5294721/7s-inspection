import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GREEN = [20, 107, 79, 255];
const WHITE = [255, 255, 255, 255];
const glyphs = {
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  S: ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function setPixel(pixels, size, x, y, color = GREEN) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const offset = (y * size + x) * 4;
  pixels.set(color, offset);
}

function fillRect(pixels, size, x, y, width, height, color = GREEN) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(pixels, size, column, row, color);
    }
  }
}

function thickLine(pixels, size, x0, y0, x1, y1, thickness) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const radius = Math.floor(thickness / 2);
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + ((x1 - x0) * step) / steps);
    const y = Math.round(y0 + ((y1 - y0) * step) / steps);
    fillRect(pixels, size, x - radius, y - radius, thickness, thickness);
  }
}

function drawGlyph(pixels, size, glyph, x, y, scale) {
  glyphs[glyph].forEach((row, rowIndex) => {
    [...row].forEach((pixel, columnIndex) => {
      if (pixel === "1") {
        fillRect(
          pixels,
          size,
          x + columnIndex * scale,
          y + rowIndex * scale,
          scale,
          scale,
        );
      }
    });
  });
}

function createIcon(size, maskable) {
  const pixels = new Uint8Array(size * size * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(WHITE, offset);

  const inset = Math.round(size * (maskable ? 0.22 : 0.13));
  const railThickness = Math.max(3, Math.round(size * 0.035));
  const sleeperThickness = Math.max(2, Math.round(size * 0.018));
  const railLeft = inset + Math.round(size * 0.08);
  const railRight = size - inset - Math.round(size * 0.08);
  const railTop = inset;
  const railBottom = Math.round(size * 0.56);

  thickLine(pixels, size, railLeft, railTop, railLeft, railBottom, railThickness);
  thickLine(pixels, size, railRight, railTop, railRight, railBottom, railThickness);
  for (let y = railTop + railThickness; y <= railBottom; y += Math.round(size * 0.075)) {
    fillRect(
      pixels,
      size,
      railLeft - railThickness,
      y,
      railRight - railLeft + railThickness * 2,
      sleeperThickness,
    );
  }

  thickLine(
    pixels,
    size,
    Math.round(size * 0.29),
    Math.round(size * 0.49),
    Math.round(size * 0.42),
    Math.round(size * 0.61),
    railThickness,
  );
  thickLine(
    pixels,
    size,
    Math.round(size * 0.42),
    Math.round(size * 0.61),
    Math.round(size * 0.71),
    Math.round(size * 0.35),
    railThickness,
  );

  const scale = Math.max(2, Math.floor(size * 0.032));
  const glyphWidth = scale * 5;
  const gap = scale * 2;
  const textWidth = glyphWidth * 2 + gap;
  const textX = Math.floor((size - textWidth) / 2);
  const textY = Math.round(size * 0.68);
  drawGlyph(pixels, size, "7", textX, textY, scale);
  drawGlyph(pixels, size, "S", textX + glyphWidth + gap, textY, scale);

  const scanline = Buffer.alloc(size * 4 + 1);
  const raw = Buffer.alloc(scanline.length * size);
  for (let y = 0; y < size; y += 1) {
    scanline[0] = 0;
    scanline.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), 1);
    scanline.copy(raw, y * scanline.length);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
];

await mkdir(resolve(scriptDirectory, "../public/icons"), { recursive: true });
await Promise.all(targets.map(([name, size, maskable]) =>
  writeFile(resolve(scriptDirectory, "../public/icons", name), createIcon(size, maskable)),
));
