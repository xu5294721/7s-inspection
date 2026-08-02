import imageCompression, { type Options as CompressionOptions } from "browser-image-compression";

export const DOCX_PHOTO_MEDIA_BUDGET = Math.floor(7.2 * 1024 * 1024);
export const DOCX_MAX_PHOTO_BYTES = 700 * 1024;
export const DOCX_MIN_PHOTO_BYTES = 90 * 1024;

const compressionAttempts = [
  { maxWidthOrHeight: 1600, initialQuality: 0.82 },
  { maxWidthOrHeight: 1600, initialQuality: 0.68 },
  { maxWidthOrHeight: 1400, initialQuality: 0.56 },
  { maxWidthOrHeight: 1200, initialQuality: 0.46 },
  { maxWidthOrHeight: 1000, initialQuality: 0.36 },
  { maxWidthOrHeight: 800, initialQuality: 0.28 },
] as const;

export interface DocxPhotoBudget {
  mediaBudgetBytes: number;
  targetBytes: number;
  maxWidthOrHeight: number;
}

export interface DocxPhotoCompressionRuntime {
  compress(file: File, options: CompressionOptions): Promise<File>;
}

const defaultRuntime: DocxPhotoCompressionRuntime = { compress: imageCompression };

export function getDocxPhotoBudget(photoCount: number): DocxPhotoBudget {
  const count = Math.max(1, Math.floor(photoCount));
  return {
    mediaBudgetBytes: DOCX_PHOTO_MEDIA_BUDGET,
    targetBytes: Math.max(
      DOCX_MIN_PHOTO_BYTES,
      Math.min(DOCX_MAX_PHOTO_BYTES, Math.floor(DOCX_PHOTO_MEDIA_BUDGET / count)),
    ),
    maxWidthOrHeight: compressionAttempts[0].maxWidthOrHeight,
  };
}

export async function compressDocxPhoto(
  sourceBlob: Blob,
  targetBytes: number,
  runtime: DocxPhotoCompressionRuntime = defaultRuntime,
): Promise<Blob> {
  if (sourceBlob.type !== "image/jpeg") throw new Error("Word照片压缩只接受JPEG");
  if (sourceBlob.size <= targetBytes) return sourceBlob;

  const source = new File([sourceBlob], "word-photo.jpg", { type: "image/jpeg" });
  let smallest: File | null = null;
  for (const attempt of compressionAttempts) {
    const result = await runtime.compress(source, {
      ...attempt,
      maxSizeMB: targetBytes / (1024 * 1024),
      fileType: "image/jpeg",
      useWebWorker: true,
    });
    if (result.type !== "image/jpeg") throw new Error("Word照片压缩未输出JPEG");
    if (!smallest || result.size < smallest.size) smallest = result;
    if (result.size <= targetBytes) return result;
  }
  if (!smallest) throw new Error("Word照片压缩失败");
  return smallest;
}
