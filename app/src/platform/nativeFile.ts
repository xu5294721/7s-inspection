import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeFilePlugin {
  saveFile(options: {
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
