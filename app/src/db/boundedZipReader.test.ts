import { deflateSync } from "fflate";
import { expect, test } from "vitest";
import type { ZipEntryMetadata } from "./zipCentralDirectory";
import {
  createZipExtractionBudget,
  extractZipEntryBounded,
} from "./boundedZipReader";

const MiB = 1024 * 1024;

function entryMetadata(
  compressedSize: number,
  uncompressedSize: number,
  compressionMethod: 0 | 8,
): ZipEntryMetadata {
  return {
    name: "data/forged.json",
    compressedSize,
    uncompressedSize,
    compressionMethod,
    dataOffset: 0,
    isDirectory: false,
  };
}

test("stops forged DEFLATE output before all 8 MiB are emitted or accumulated", async () => {
  const actual = new Uint8Array(8 * MiB);
  const compressed = deflateSync(actual, { level: 9 });
  const budget = createZipExtractionBudget();

  await expect(extractZipEntryBounded(
    new Blob([compressed]),
    entryMetadata(compressed.byteLength, 1, 8),
    budget,
    {
      maxEntryBytes: 16 * MiB,
      maxTotalBytes: 512 * MiB,
      maxCompressionRatio: 200,
    },
  )).rejects.toThrow(/实际解压压缩比.*200/);

  expect(budget.actualBytes).toBeGreaterThan(0);
  expect(budget.actualBytes).toBeLessThan(actual.byteLength);
});

test("returns honest DEFLATE output exactly once and accounts for its actual bytes", async () => {
  const actual = new TextEncoder().encode("bounded ZIP reader round trip");
  const compressed = deflateSync(actual, { level: 6 });
  const budget = createZipExtractionBudget();

  const restored = await extractZipEntryBounded(
    new Blob([compressed]),
    entryMetadata(compressed.byteLength, actual.byteLength, 8),
    budget,
    { maxEntryBytes: 1024, maxTotalBytes: 2048, maxCompressionRatio: 200 },
  );

  expect(Array.from(restored)).toEqual(Array.from(actual));
  expect(budget.actualBytes).toBe(actual.byteLength);
});

test("enforces the per-entry limit from actual STORE bytes instead of the declared size", async () => {
  const actual = new Uint8Array(12);
  const budget = createZipExtractionBudget();

  await expect(extractZipEntryBounded(
    new Blob([actual]),
    entryMetadata(actual.byteLength, 1, 0),
    budget,
    { maxEntryBytes: 10, maxTotalBytes: 100, maxCompressionRatio: 200 },
  )).rejects.toThrow(/实际解压大小/);

  expect(budget.actualBytes).toBe(11);
});

test("enforces the cumulative actual-byte budget across unique STORE entries", async () => {
  const first = new Uint8Array(7);
  const second = new Uint8Array(7);
  const blob = new Blob([first, second]);
  const budget = createZipExtractionBudget();
  const limits = { maxEntryBytes: 10, maxTotalBytes: 12, maxCompressionRatio: 200 };

  await extractZipEntryBounded(blob, entryMetadata(7, 7, 0), budget, limits);
  await expect(extractZipEntryBounded(
    blob,
    { ...entryMetadata(7, 7, 0), name: "data/second.json", dataOffset: 7 },
    budget,
    limits,
  )).rejects.toThrow(/实际解压总大小/);

  expect(budget.actualBytes).toBe(13);
});
