const localFileSignature = 0x04034b50;
const centralFileSignature = 0x02014b50;
const endOfCentralSignature = 0x06054b50;
const maxUint32 = 0xffffffff;

interface ParsedZipEntry {
  name: string;
  localOffset: number;
  localEnd: number;
  centralRecord: Uint8Array<ArrayBuffer>;
  flags: number;
  modifiedTime: number;
  modifiedDate: number;
}

interface ReplacementMetadata {
  crc32: number;
  size: number;
  localOffset: number;
}

function uint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function setUint16(bytes: Uint8Array<ArrayBuffer>, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function setUint32(bytes: Uint8Array<ArrayBuffer>, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function findEndOfCentral(bytes: Uint8Array<ArrayBuffer>): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
    if (uint32(view, offset) === endOfCentralSignature) return offset;
  }
  throw new Error("DOCX ZIP缺少中央目录。");
}

function parseZip(bytes: Uint8Array<ArrayBuffer>): { entries: ParsedZipEntry[]; centralOffset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentral(bytes);
  const entryCount = uint16(view, endOffset + 10);
  const centralSize = uint32(view, endOffset + 12);
  const centralOffset = uint32(view, endOffset + 16);
  if (
    uint16(view, endOffset + 4) !== 0 ||
    uint16(view, endOffset + 6) !== 0 ||
    entryCount === 0xffff ||
    centralSize === maxUint32 ||
    centralOffset === maxUint32 ||
    centralOffset + centralSize > endOffset
  ) {
    throw new Error("DOCX ZIP格式不受支持。");
  }

  const decoder = new TextDecoder();
  const entries: ParsedZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (uint32(view, offset) !== centralFileSignature) {
      throw new Error("DOCX ZIP中央目录损坏。");
    }
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    entries.push({
      name: decoder.decode(nameBytes),
      localOffset: uint32(view, offset + 42),
      localEnd: 0,
      centralRecord: bytes.slice(offset, offset + recordLength),
      flags: uint16(view, offset + 8),
      modifiedTime: uint16(view, offset + 12),
      modifiedDate: uint16(view, offset + 14),
    });
    offset += recordLength;
  }

  const byLocalOffset = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  byLocalOffset.forEach((entry, index) => {
    if (uint32(view, entry.localOffset) !== localFileSignature) {
      throw new Error("DOCX ZIP本地文件头损坏。");
    }
    entry.localEnd = byLocalOffset[index + 1]?.localOffset ?? centralOffset;
  });
  return { entries, centralOffset };
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (const byte of bytes) {
    next = crcTable[(next ^ byte) & 0xff] ^ (next >>> 8);
  }
  return next >>> 0;
}

async function blobCrc32(blob: Blob): Promise<number> {
  let crc = maxUint32;
  if (typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        crc = updateCrc32(crc, value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    crc = updateCrc32(crc, new Uint8Array(await blob.arrayBuffer()));
  }
  return (crc ^ maxUint32) >>> 0;
}

function mediaLocalRecord(entry: ParsedZipEntry, blob: Blob, crc32: number): Uint8Array<ArrayBuffer> {
  const nameBytes = entry.centralRecord.slice(46, 46 + uint16(
    new DataView(entry.centralRecord.buffer, entry.centralRecord.byteOffset, entry.centralRecord.byteLength),
    28,
  ));
  const header = new Uint8Array(30 + nameBytes.byteLength);
  setUint32(header, 0, localFileSignature);
  setUint16(header, 4, 20);
  setUint16(header, 6, entry.flags & 0x0800);
  setUint16(header, 8, 0);
  setUint16(header, 10, entry.modifiedTime);
  setUint16(header, 12, entry.modifiedDate);
  setUint32(header, 14, crc32);
  setUint32(header, 18, blob.size);
  setUint32(header, 22, blob.size);
  setUint16(header, 26, nameBytes.byteLength);
  setUint16(header, 28, 0);
  header.set(nameBytes, 30);
  return header;
}

function endOfCentralRecord(entryCount: number, centralSize: number, centralOffset: number): Uint8Array<ArrayBuffer> {
  const record = new Uint8Array(22);
  setUint32(record, 0, endOfCentralSignature);
  setUint16(record, 8, entryCount);
  setUint16(record, 10, entryCount);
  setUint32(record, 12, centralSize);
  setUint32(record, 16, centralOffset);
  return record;
}

export async function replaceZipMediaSequentially(
  skeleton: ArrayBuffer,
  replacements: ReadonlyMap<string, () => Promise<Blob>>,
  onReplaced: (path: string) => void,
): Promise<Blob> {
  const bytes = new Uint8Array(skeleton);
  const { entries } = parseZip(bytes);
  if (entries.length > 0xffff) throw new Error("DOCX ZIP文件项过多。");
  const parts: BlobPart[] = [];
  const offsets = new Map<string, number>();
  const replacementMetadata = new Map<string, ReplacementMetadata>();
  let outputOffset = 0;

  for (const entry of [...entries].sort((left, right) => left.localOffset - right.localOffset)) {
    offsets.set(entry.name, outputOffset);
    const replacement = replacements.get(entry.name);
    if (!replacement) {
      const record = bytes.slice(entry.localOffset, entry.localEnd);
      parts.push(record);
      outputOffset += record.byteLength;
      continue;
    }

    const blob = await replacement();
    if (blob.size > maxUint32) throw new Error(`照片 ${entry.name} 超出ZIP32大小限制。`);
    const crc32 = await blobCrc32(blob);
    const header = mediaLocalRecord(entry, blob, crc32);
    parts.push(header, blob);
    replacementMetadata.set(entry.name, { crc32, size: blob.size, localOffset: outputOffset });
    outputOffset += header.byteLength + blob.size;
    onReplaced(entry.name);
  }

  for (const path of replacements.keys()) {
    if (!replacementMetadata.has(path)) throw new Error(`DOCX媒体文件 ${path} 不存在。`);
  }
  if (outputOffset > maxUint32) throw new Error("DOCX ZIP超出ZIP32大小限制。");

  const centralOffset = outputOffset;
  for (const entry of entries) {
    const record = entry.centralRecord.slice();
    const replacement = replacementMetadata.get(entry.name);
    setUint32(record, 42, offsets.get(entry.name) ?? 0);
    if (replacement) {
      setUint16(record, 6, 20);
      setUint16(record, 8, entry.flags & 0x0800);
      setUint16(record, 10, 0);
      setUint32(record, 16, replacement.crc32);
      setUint32(record, 20, replacement.size);
      setUint32(record, 24, replacement.size);
    }
    parts.push(record);
    outputOffset += record.byteLength;
  }
  const centralSize = outputOffset - centralOffset;
  parts.push(endOfCentralRecord(entries.length, centralSize, centralOffset));
  return new Blob(parts, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
