const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const EOCD_FIXED_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const ZIP64_LOCATOR_BYTES = 20;
const CENTRAL_HEADER_FIXED_BYTES = 46;
const LOCAL_HEADER_FIXED_BYTES = 30;

export interface ZipCentralDirectoryLimits {
  maxEntries: number;
  maxCentralDirectoryBytes: number;
}

export interface ZipEntryMetadata {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: 0 | 8;
  dataOffset: number;
  isDirectory: boolean;
}

export interface ZipCentralDirectoryMetadata {
  entries: ZipEntryMetadata[];
  entriesByName: Map<string, ZipEntryMetadata>;
}

interface ParsedCentralEntry extends Omit<ZipEntryMetadata, "dataOffset"> {
  bitFlag: number;
  crc32: number;
  localHeaderOffset: number;
  rawName: Uint8Array;
}

export class ZipCentralDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipCentralDirectoryError";
  }
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Response(blob).arrayBuffer());
}

async function readSlice(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(start) || start < 0 ||
    !Number.isSafeInteger(length) || length < 0 ||
    start + length > blob.size
  ) {
    throw new ZipCentralDirectoryError("备份ZIP的目录偏移或长度无效。");
  }
  return readBlobBytes(blob.slice(start, start + length));
}

function findEocd(tail: Uint8Array, tailStart: number, blobSize: number): number {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let offset = tail.byteLength - EOCD_FIXED_BYTES; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (tailStart + offset + EOCD_FIXED_BYTES + commentLength === blobSize) {
      return offset;
    }
  }
  throw new ZipCentralDirectoryError("备份ZIP缺少有效的中央目录结束记录。");
}

function decodeEntryName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw new ZipCentralDirectoryError("备份ZIP包含不支持的文件名编码。");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ZipCentralDirectoryError("备份ZIP包含无效的UTF-8文件名。");
  }
}

function assertExtraFields(bytes: Uint8Array, label: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + 4 > bytes.byteLength) {
      throw new ZipCentralDirectoryError(`备份ZIP的${label}扩展字段结构损坏。`);
    }
    const id = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + length > bytes.byteLength) {
      throw new ZipCentralDirectoryError(`备份ZIP的${label}扩展字段长度无效。`);
    }
    if (id === ZIP64_EXTRA_FIELD_ID) {
      throw new ZipCentralDirectoryError("备份ZIP不能使用ZIP64格式。");
    }
    offset += length;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

async function parseLocalHeaders(
  blob: Blob,
  entries: ParsedCentralEntry[],
  centralDirectoryOffset: number,
): Promise<ZipEntryMetadata[]> {
  const localOrder = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  if (localOrder.length > 0 && localOrder[0].localHeaderOffset !== 0) {
    throw new ZipCentralDirectoryError("备份ZIP的本地文件头起始偏移不一致。");
  }

  const resultByName = new Map<string, ZipEntryMetadata>();
  let previousDataEnd = 0;
  for (const entry of localOrder) {
    if (entry.localHeaderOffset !== previousDataEnd) {
      throw new ZipCentralDirectoryError("备份ZIP的本地文件头或压缩数据范围不连续。");
    }
    const fixed = await readSlice(blob, entry.localHeaderOffset, LOCAL_HEADER_FIXED_BYTES);
    const view = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
    if (view.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new ZipCentralDirectoryError("备份ZIP的本地文件头结构损坏。");
    }
    const bitFlag = view.getUint16(6, true);
    const compressionMethod = view.getUint16(8, true);
    const crc32 = view.getUint32(14, true);
    const compressedSize = view.getUint32(18, true);
    const uncompressedSize = view.getUint32(22, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    if (
      bitFlag !== entry.bitFlag || compressionMethod !== entry.compressionMethod ||
      crc32 !== entry.crc32 || compressedSize !== entry.compressedSize ||
      uncompressedSize !== entry.uncompressedSize
    ) {
      throw new ZipCentralDirectoryError("备份ZIP的本地文件头与中央目录信息不一致。");
    }
    const variable = await readSlice(
      blob,
      entry.localHeaderOffset + LOCAL_HEADER_FIXED_BYTES,
      nameLength + extraLength,
    );
    const localName = variable.subarray(0, nameLength);
    if (!sameBytes(localName, entry.rawName)) {
      throw new ZipCentralDirectoryError("备份ZIP的本地文件名与中央目录不一致。");
    }
    assertExtraFields(variable.subarray(nameLength), "本地文件头");
    const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_FIXED_BYTES + nameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > centralDirectoryOffset) {
      throw new ZipCentralDirectoryError("备份ZIP的压缩数据范围无效。");
    }
    previousDataEnd = dataEnd;
    resultByName.set(entry.name, {
      name: entry.name,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      compressionMethod: entry.compressionMethod,
      dataOffset,
      isDirectory: entry.isDirectory,
    });
  }
  if (previousDataEnd !== centralDirectoryOffset) {
    throw new ZipCentralDirectoryError("备份ZIP的本地数据末尾与中央目录偏移不一致。");
  }
  return entries.map((entry) => {
    const parsed = resultByName.get(entry.name);
    if (!parsed) throw new ZipCentralDirectoryError("备份ZIP的本地文件头不完整。");
    return parsed;
  });
}

export async function parseZipCentralDirectory(
  blob: Blob,
  limits: ZipCentralDirectoryLimits,
): Promise<ZipCentralDirectoryMetadata> {
  const tailLength = Math.min(blob.size, EOCD_FIXED_BYTES + MAX_ZIP_COMMENT_BYTES + ZIP64_LOCATOR_BYTES);
  const tailStart = blob.size - tailLength;
  const tail = await readSlice(blob, tailStart, tailLength);
  const relativeEocdOffset = findEocd(tail, tailStart, blob.size);
  const eocdOffset = tailStart + relativeEocdOffset;
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  if (
    relativeEocdOffset >= ZIP64_LOCATOR_BYTES &&
    view.getUint32(relativeEocdOffset - ZIP64_LOCATOR_BYTES, true) === ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    throw new ZipCentralDirectoryError("备份ZIP不能使用ZIP64格式。");
  }

  const diskNumber = view.getUint16(relativeEocdOffset + 4, true);
  const centralDisk = view.getUint16(relativeEocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(relativeEocdOffset + 8, true);
  const declaredEntries = view.getUint16(relativeEocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(relativeEocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(relativeEocdOffset + 16, true);
  if (
    entriesOnDisk === 0xffff || declaredEntries === 0xffff ||
    centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff
  ) {
    throw new ZipCentralDirectoryError("备份ZIP不能使用ZIP64格式。");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== declaredEntries) {
    throw new ZipCentralDirectoryError("备份ZIP不能使用分卷或多磁盘格式。");
  }
  if (centralDirectorySize > limits.maxCentralDirectoryBytes) {
    throw new ZipCentralDirectoryError(
      `备份ZIP中央目录不能超过${Math.floor(limits.maxCentralDirectoryBytes / 1024 / 1024)} MB。`,
    );
  }
  if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    throw new ZipCentralDirectoryError("备份ZIP中央目录的偏移或长度不一致。");
  }

  const central = await readSlice(blob, centralDirectoryOffset, centralDirectorySize);
  const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const entries: ParsedCentralEntry[] = [];
  const names = new Set<string>();
  let offset = 0;
  while (offset < central.byteLength) {
    if (
      offset + CENTRAL_HEADER_FIXED_BYTES > central.byteLength ||
      centralView.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE
    ) {
      throw new ZipCentralDirectoryError("备份ZIP中央目录结构损坏。");
    }
    if (entries.length >= limits.maxEntries) {
      throw new ZipCentralDirectoryError(`备份ZIP实际条目数量不能超过${limits.maxEntries}个。`);
    }
    const bitFlag = centralView.getUint16(offset + 8, true);
    const compressionMethod = centralView.getUint16(offset + 10, true);
    const crc32 = centralView.getUint32(offset + 16, true);
    const compressedSize = centralView.getUint32(offset + 20, true);
    const uncompressedSize = centralView.getUint32(offset + 24, true);
    const nameLength = centralView.getUint16(offset + 28, true);
    const extraLength = centralView.getUint16(offset + 30, true);
    const commentLength = centralView.getUint16(offset + 32, true);
    const diskStart = centralView.getUint16(offset + 34, true);
    const externalAttributes = centralView.getUint32(offset + 38, true);
    const localHeaderOffset = centralView.getUint32(offset + 42, true);
    const variableLength = nameLength + extraLength + commentLength;
    const nextOffset = offset + CENTRAL_HEADER_FIXED_BYTES + variableLength;
    if (nameLength === 0 || nextOffset > central.byteLength) {
      throw new ZipCentralDirectoryError("备份ZIP中央目录的可变字段长度无效。");
    }
    if (
      compressedSize === 0xffffffff || uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff || diskStart === 0xffff
    ) {
      throw new ZipCentralDirectoryError("备份ZIP不能使用ZIP64格式。");
    }
    if (diskStart !== 0) throw new ZipCentralDirectoryError("备份ZIP不能使用分卷或多磁盘格式。");
    if ((bitFlag & 0x0001) !== 0) throw new ZipCentralDirectoryError("备份ZIP不能包含加密条目。");
    if ((bitFlag & 0x0008) !== 0) {
      throw new ZipCentralDirectoryError("备份ZIP不能使用数据描述符格式。");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new ZipCentralDirectoryError("备份ZIP包含不支持的压缩方式。");
    }

    const nameStart = offset + CENTRAL_HEADER_FIXED_BYTES;
    const rawName = central.subarray(nameStart, nameStart + nameLength);
    const extra = central.subarray(nameStart + nameLength, nameStart + nameLength + extraLength);
    assertExtraFields(extra, "中央目录");
    const name = decodeEntryName(rawName, (bitFlag & 0x0800) !== 0);
    if (names.has(name)) throw new ZipCentralDirectoryError(`备份ZIP包含重复路径：${name}。`);
    names.add(name);
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      isDirectory: name.endsWith("/") || (externalAttributes & 0x10) !== 0,
      bitFlag,
      crc32,
      localHeaderOffset,
      rawName,
    });
    offset = nextOffset;
  }
  if (entries.length !== declaredEntries) {
    throw new ZipCentralDirectoryError("备份ZIP中央目录声明的条目数与实际条目数不一致。");
  }

  const parsedEntries = await parseLocalHeaders(blob, entries, centralDirectoryOffset);
  return {
    entries: parsedEntries,
    entriesByName: new Map(parsedEntries.map((entry) => [entry.name, entry])),
  };
}
