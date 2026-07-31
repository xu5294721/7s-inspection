import { Inflate } from "fflate";
import type { ZipEntryMetadata } from "./zipCentralDirectory";

const DEFLATE_INPUT_CHUNK_BYTES = 1024;
const STORE_INPUT_CHUNK_BYTES = 64 * 1024;
const CORRUPT_ARCHIVE_MESSAGE = "备份文件损坏，无法读取其中的数据，请重新选择有效备份。";

export interface ZipExtractionBudget {
  actualBytes: number;
}

export interface ZipEntryExtractionLimits {
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxCompressionRatio: number;
}

export class BoundedZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedZipReadError";
  }
}

export function createZipExtractionBudget(): ZipExtractionBudget {
  return { actualBytes: 0 };
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Response(blob).arrayBuffer());
}

function concatChunks(
  chunks: Uint8Array<ArrayBuffer>[],
  totalBytes: number,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function extractZipEntryBounded(
  archive: Blob,
  entry: ZipEntryMetadata,
  budget: ZipExtractionBudget,
  limits: ZipEntryExtractionLimits,
): Promise<Uint8Array<ArrayBuffer>> {
  if (entry.isDirectory) throw new BoundedZipReadError(`备份ZIP路径 ${entry.name} 不是文件。`);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let entryActualBytes = 0;

  function acceptChunk(chunk: Uint8Array<ArrayBuffer>): void {
    if (chunk.byteLength === 0) return;
    entryActualBytes += chunk.byteLength;
    budget.actualBytes += chunk.byteLength;
    if (entryActualBytes > limits.maxEntryBytes) {
      throw new BoundedZipReadError(`备份条目 ${entry.name} 的实际解压大小超过允许上限。`);
    }
    if (budget.actualBytes > limits.maxTotalBytes) {
      throw new BoundedZipReadError("备份ZIP的实际解压总大小超过允许上限。");
    }
    if (
      entry.compressedSize === 0 ||
      entryActualBytes / entry.compressedSize > limits.maxCompressionRatio
    ) {
      throw new BoundedZipReadError(
        `备份条目 ${entry.name} 的实际解压压缩比不能超过${limits.maxCompressionRatio}倍。`,
      );
    }
    chunks.push(chunk);
  }

  try {
    const dataEnd = entry.dataOffset + entry.compressedSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > archive.size) {
      throw new BoundedZipReadError("备份ZIP的压缩数据范围无效。");
    }
    if (entry.compressionMethod === 0) {
      let offset = entry.dataOffset;
      while (offset < dataEnd) {
        const remainingEntryBudget = Math.max(1, limits.maxEntryBytes - entryActualBytes + 1);
        const remainingTotalBudget = Math.max(1, limits.maxTotalBytes - budget.actualBytes + 1);
        const ratioBoundary = Math.max(
          1,
          Math.floor(entry.compressedSize * limits.maxCompressionRatio - entryActualBytes) + 1,
        );
        const length = Math.min(
          STORE_INPUT_CHUNK_BYTES,
          dataEnd - offset,
          remainingEntryBudget,
          remainingTotalBudget,
          ratioBoundary,
        );
        const chunk = await readBlobBytes(archive.slice(offset, offset + length));
        if (chunk.byteLength !== length) throw new BoundedZipReadError(CORRUPT_ARCHIVE_MESSAGE);
        acceptChunk(chunk);
        offset += length;
      }
    } else {
      const inflate = new Inflate((chunk) => acceptChunk(chunk));
      let offset = entry.dataOffset;
      while (offset < dataEnd) {
        const length = Math.min(DEFLATE_INPUT_CHUNK_BYTES, dataEnd - offset);
        const chunk = await readBlobBytes(archive.slice(offset, offset + length));
        if (chunk.byteLength !== length) throw new BoundedZipReadError(CORRUPT_ARCHIVE_MESSAGE);
        offset += length;
        inflate.push(chunk, offset === dataEnd);
      }
    }
  } catch (error) {
    if (error instanceof BoundedZipReadError) throw error;
    throw new BoundedZipReadError(CORRUPT_ARCHIVE_MESSAGE);
  }

  if (entryActualBytes !== entry.uncompressedSize) {
    throw new BoundedZipReadError(CORRUPT_ARCHIVE_MESSAGE);
  }
  return concatChunks(chunks, entryActualBytes);
}
