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
