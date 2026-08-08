import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GREEN = [8, 116, 86, 255];
const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

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

function setPixel(pixels, size, x, y, color) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const offset = (y * size + x) * 4;
  pixels.set(color, offset);
}

function fillRoundedRect(pixels, size, x, y, width, height, radius, color) {
  const right = x + width;
  const bottom = y + height;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const pointX = column + 0.5;
      const pointY = row + 0.5;
      const closestX = Math.max(x + radius, Math.min(pointX, right - radius));
      const closestY = Math.max(y + radius, Math.min(pointY, bottom - radius));
      const deltaX = pointX - closestX;
      const deltaY = pointY - closestY;
      if (deltaX * deltaX + deltaY * deltaY <= radius * radius) {
        setPixel(pixels, size, column, row, color);
      }
    }
  }
}

function distanceToSegmentSquared(pointX, pointY, startX, startY, endX, endY) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared));
  const closestX = startX + projection * deltaX;
  const closestY = startY + projection * deltaY;
  const distanceX = pointX - closestX;
  const distanceY = pointY - closestY;
  return distanceX * distanceX + distanceY * distanceY;
}

function drawStroke(pixels, size, points, thickness, color) {
  const radius = thickness / 2;
  const minX = Math.max(0, Math.floor(Math.min(...points.map(([x]) => x)) - radius));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(...points.map(([x]) => x)) + radius));
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y)) - radius));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(...points.map(([, y]) => y)) + radius));

  for (let row = minY; row <= maxY; row += 1) {
    for (let column = minX; column <= maxX; column += 1) {
      const pointX = column + 0.5;
      const pointY = row + 0.5;
      const isInside = points.some((point, index) => {
        if (index === points.length - 1) return false;
        const next = points[index + 1];
        return distanceToSegmentSquared(pointX, pointY, point[0], point[1], next[0], next[1]) <= radius * radius;
      });
      if (isInside) setPixel(pixels, size, column, row, color);
    }
  }
}

function scalePoints(size, points) {
  return points.map(([x, y]) => [x * size, y * size]);
}

function createIcon(size, maskable) {
  const pixels = new Uint8Array(size * size * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(TRANSPARENT, offset);

  if (maskable) {
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(GREEN, offset);
  } else {
    fillRoundedRect(
      pixels,
      size,
      size * 0.0215,
      size * 0.0215,
      size * 0.957,
      size * 0.957,
      size * 0.232,
      GREEN,
    );
  }

  drawStroke(pixels, size, scalePoints(size, [[0.221, 0.373], [0.779, 0.293]]), size * 0.055, WHITE);
  drawStroke(pixels, size, scalePoints(size, [[0.221, 0.535], [0.779, 0.455]]), size * 0.055, WHITE);
  drawStroke(pixels, size, scalePoints(size, [[0.264, 0.467], [0.459, 0.67], [0.779, 0.301]]), size * 0.08, WHITE);

  const scanline = Buffer.alloc(size * 4 + 1);
  const raw = Buffer.alloc(scanline.length * size);
  for (let row = 0; row < size; row += 1) {
    scanline[0] = 0;
    scanline.set(pixels.subarray(row * size * 4, (row + 1) * size * 4), 1);
    scanline.copy(raw, row * scanline.length);
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
