import JSZip from "jszip";
import { expect, test } from "vitest";
import {
  parseZipCentralDirectory,
  ZipCentralDirectoryError,
} from "./zipCentralDirectory";

const MiB = 1024 * 1024;
const limits = { maxEntries: 4096, maxCentralDirectoryBytes: 4 * MiB };

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

class SliceTrackingBlob extends Blob {
  readonly sliceSizes: number[] = [];

  override slice(start?: number, end?: number, contentType?: string): Blob {
    const normalizedStart = start ?? 0;
    const normalizedEnd = end ?? this.size;
    this.sliceSizes.push(Math.max(0, normalizedEnd - normalizedStart));
    return super.slice(start, end, contentType);
  }
}

function eocdOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength
    ) return offset;
  }
  throw new Error("test EOCD missing");
}

test("parses central and matching local metadata without slicing a large entry payload", async () => {
  const zip = new JSZip();
  zip.file("data/large.bin", new Uint8Array(8 * MiB), { createFolders: false });
  const generated = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const archive = new SliceTrackingBlob([ownedBytes(generated)], { type: "application/zip" });

  const metadata = await parseZipCentralDirectory(archive, limits);

  expect(metadata.entries).toHaveLength(1);
  expect(metadata.entries[0]).toMatchObject({
    name: "data/large.bin",
    compressedSize: 8 * MiB,
    uncompressedSize: 8 * MiB,
    compressionMethod: 0,
  });
  expect(Math.max(...archive.sliceSizes)).toBeLessThan(8 * MiB);
  expect(archive.sliceSizes).toContain(30);
});

test("rejects a forged EOCD count that disagrees with walked central headers", async () => {
  const zip = new JSZip();
  zip.file("first", "");
  zip.file("second", "");
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = eocdOffset(bytes);
  view.setUint16(offset + 8, 1, true);
  view.setUint16(offset + 10, 1, true);

  await expect(parseZipCentralDirectory(new Blob([ownedBytes(bytes)]), limits)).rejects.toMatchObject({
    name: "ZipCentralDirectoryError",
    message: expect.stringMatching(/声明的条目数与实际条目数不一致/),
  } satisfies Partial<ZipCentralDirectoryError>);
});

test("rejects local header sizes that disagree with central metadata", async () => {
  const zip = new JSZip();
  zip.file("manifest.json", "{}");
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(22, 1, true);

  await expect(parseZipCentralDirectory(new Blob([ownedBytes(bytes)]), limits)).rejects.toThrow(
    /本地文件头与中央目录信息不一致/,
  );
});

test("classifies a central-entry ZIP64 disk sentinel before multi-disk validation", async () => {
  const zip = new JSZip();
  zip.file("manifest.json", "{}");
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralOffset = view.getUint32(eocdOffset(bytes) + 16, true);
  view.setUint16(centralOffset + 34, 0xffff, true);

  await expect(parseZipCentralDirectory(new Blob([ownedBytes(bytes)]), limits)).rejects.toThrow(/ZIP64/);
});
