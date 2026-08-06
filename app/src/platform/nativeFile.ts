import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeFilePlugin {
  saveFile(options: {
    data: string;
    filename: string;
    mimeType: string;
  }): Promise<{ uri: string }>;
  saveImage(options: {
    data: string;
    filename: string;
    mimeType: string;
  }): Promise<{ uri: string }>;
  saveFileBegin(options: {
    filename: string;
    mimeType: string;
  }): Promise<{ sessionId: string }>;
  saveFileAppend(options: {
    sessionId: string;
    data: string;
  }): Promise<void>;
  saveFileEnd(options: {
    sessionId: string;
  }): Promise<{ uri: string }>;
  saveFileAbort(options: {
    sessionId: string;
  }): Promise<void>;
}

const nativeFile = registerPlugin<NativeFilePlugin>("NativeFile");

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function saveBlobToDownloads(blob: Blob, filename: string): Promise<void> {
  if (isNativeAndroid()) {
    await nativeFile.saveFile({
      data: await blobToBase64(blob),
      filename,
      mimeType: blob.type || "application/octet-stream",
    });
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

function imageExtension(file: File): string {
  const fromName = file.name.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function galleryFilename(file: File): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `7S巡检_${timestamp}.${imageExtension(file)}`;
}

export async function saveCapturedPhotoToGallery(file: File): Promise<void> {
  if (!isNativeAndroid()) return;
  if (!file.type.startsWith("image/")) throw new Error("只能保存图片到相册。");
  await nativeFile.saveImage({
    data: await blobToBase64(file),
    filename: galleryFilename(file),
    mimeType: file.type || "image/jpeg",
  });
}

const CHUNK_BASE64_TARGET_BYTES = 256 * 1024;

async function* accumulateChunks(
  source: AsyncIterable<Uint8Array>,
  targetBytes: number,
): AsyncIterable<Uint8Array> {
  const parts: Uint8Array[] = [];
  let bufferedBytes = 0;
  for await (const chunk of source) {
    let remainder = chunk;
    while (remainder.byteLength + bufferedBytes >= targetBytes) {
      const take = targetBytes - bufferedBytes;
      parts.push(remainder.subarray(0, take));
      bufferedBytes += take;
      const merged = new Uint8Array(bufferedBytes);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.byteLength;
      }
      yield merged;
      parts.length = 0;
      bufferedBytes = 0;
      remainder = remainder.subarray(take);
      if (remainder.byteLength === 0) break;
    }
    if (remainder.byteLength > 0) {
      parts.push(remainder);
      bufferedBytes += remainder.byteLength;
    }
  }
  if (bufferedBytes > 0) {
    const merged = new Uint8Array(bufferedBytes);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    yield merged;
  }
}

function chunkToBase64(chunk: Uint8Array): string {
  let binary = "";
  const pieceSize = 0x8000;
  for (let offset = 0; offset < chunk.byteLength; offset += pieceSize) {
    binary += String.fromCharCode(...chunk.subarray(offset, offset + pieceSize));
  }
  return btoa(binary);
}

export async function saveChunkStreamToDownloads(
  chunks: AsyncIterable<Uint8Array>,
  filename: string,
  mimeType: string,
): Promise<void> {
  if (isNativeAndroid()) {
    const { sessionId } = await nativeFile.saveFileBegin({ filename, mimeType });
    try {
      for await (const chunk of accumulateChunks(chunks, CHUNK_BASE64_TARGET_BYTES)) {
        await nativeFile.saveFileAppend({ sessionId, data: chunkToBase64(chunk) });
      }
      await nativeFile.saveFileEnd({ sessionId });
    } catch (error) {
      await nativeFile.saveFileAbort({ sessionId }).catch(() => undefined);
      throw error;
    }
    return;
  }
  const parts: BlobPart[] = [];
  for await (const chunk of accumulateChunks(chunks, CHUNK_BASE64_TARGET_BYTES)) {
    parts.push(chunk);
  }
  await saveBlobToDownloads(new Blob(parts, { type: mimeType }), filename);
}
