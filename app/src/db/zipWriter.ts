const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_FIXED_BYTES = 30;
const CENTRAL_HEADER_FIXED_BYTES = 46;
const EOCD_BYTES = 22;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function setUint16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function setUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

export interface StoredZipWriter {
  addFile(name: string, data: Uint8Array): void;
  end(): void;
}

export function createStoredZipWriter(emit: (chunk: Uint8Array) => void): StoredZipWriter {
  const centralRecords: Uint8Array[] = [];
  const offsets: number[] = [];
  let outputOffset = 0;
  let entryCount = 0;

  function emitUint8(bytes: Uint8Array): void {
    emit(bytes);
    outputOffset += bytes.byteLength;
  }

  return {
    addFile(name, data) {
      const encodedName = new TextEncoder().encode(name);
      const crc = crc32(data);
      const size = data.byteLength;

      const localHeader = new Uint8Array(LOCAL_HEADER_FIXED_BYTES + encodedName.byteLength);
      setUint32(localHeader, 0, LOCAL_FILE_SIGNATURE);
      setUint16(localHeader, 4, 20); // version needed
      setUint16(localHeader, 6, UTF8_FLAG);
      setUint16(localHeader, 8, STORE_METHOD);
      setUint16(localHeader, 10, 0); // mod time
      setUint16(localHeader, 12, 0); // mod date
      setUint32(localHeader, 14, crc);
      setUint32(localHeader, 18, size);
      setUint32(localHeader, 22, size);
      setUint16(localHeader, 26, encodedName.byteLength);
      setUint16(localHeader, 28, 0); // extra length
      localHeader.set(encodedName, LOCAL_HEADER_FIXED_BYTES);

      const centralHeader = new Uint8Array(CENTRAL_HEADER_FIXED_BYTES + encodedName.byteLength);
      setUint32(centralHeader, 0, CENTRAL_FILE_SIGNATURE);
      setUint16(centralHeader, 4, 20); // version made by
      setUint16(centralHeader, 6, 20); // version needed
      setUint16(centralHeader, 8, UTF8_FLAG);
      setUint16(centralHeader, 10, STORE_METHOD);
      setUint16(centralHeader, 12, 0); // mod time
      setUint16(centralHeader, 14, 0); // mod date
      setUint32(centralHeader, 16, crc);
      setUint32(centralHeader, 20, size);
      setUint32(centralHeader, 24, size);
      setUint16(centralHeader, 28, encodedName.byteLength);
      setUint16(centralHeader, 30, 0); // extra length
      setUint16(centralHeader, 32, 0); // comment length
      setUint16(centralHeader, 34, 0); // disk number
      setUint16(centralHeader, 36, 0); // internal attrs
      setUint32(centralHeader, 38, 0); // external attrs
      centralHeader.set(encodedName, CENTRAL_HEADER_FIXED_BYTES);

      offsets.push(outputOffset);
      emitUint8(localHeader);
      emitUint8(data);
      centralRecords.push(centralHeader);
      entryCount += 1;
    },
    end() {
      const centralOffset = outputOffset;
      let centralSize = 0;
      centralRecords.forEach((record, index) => {
        setUint32(record, 42, offsets[index]);
        emitUint8(record);
        centralSize += record.byteLength;
      });
      const eocd = new Uint8Array(EOCD_BYTES);
      setUint32(eocd, 0, END_OF_CENTRAL_SIGNATURE);
      setUint16(eocd, 8, entryCount);
      setUint16(eocd, 10, entryCount);
      setUint32(eocd, 12, centralSize);
      setUint32(eocd, 16, centralOffset);
      emitUint8(eocd);
    },
  };
}
