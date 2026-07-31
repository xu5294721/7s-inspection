import imageCompression, { type Options as CompressionOptions } from "browser-image-compression";

export interface CompressionPlanInput {
  width: number;
  height: number;
  highQuality: boolean;
}

export interface CompressionPlan {
  maxWidthOrHeight: number;
  initialQuality: number;
  fileType: "image/jpeg";
}

export interface ProcessImageOptions {
  highQuality: boolean;
  signal?: AbortSignal;
}

export interface ProcessedImage {
  imageBlob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  highQuality: boolean;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageProcessingRuntime {
  compress(file: File, options: CompressionOptions): Promise<File>;
  readDimensions(blob: Blob, signal?: AbortSignal): Promise<ImageDimensions>;
}

export function getCompressionPlan({
  width,
  height,
  highQuality,
}: CompressionPlanInput): CompressionPlan {
  return {
    maxWidthOrHeight: highQuality ? Math.max(width, height) : 2000,
    initialQuality: 0.85,
    fileType: "image/jpeg",
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("照片处理已取消", "AbortError");
  }
}

async function readImageDimensions(blob: Blob, signal?: AbortSignal): Promise<ImageDimensions> {
  throwIfAborted(signal);
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    try {
      throwIfAborted(signal);
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  return new Promise<ImageDimensions>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      URL.revokeObjectURL(objectUrl);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("照片处理已取消", "AbortError"));
    };
    image.onload = () => {
      cleanup();
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("无法读取图片尺寸"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    image.src = objectUrl;
  });
}

const defaultRuntime: ImageProcessingRuntime = {
  compress: imageCompression,
  readDimensions: readImageDimensions,
};

export async function processImage(
  file: File,
  { highQuality, signal }: ProcessImageOptions,
  runtime?: ImageProcessingRuntime,
): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("只能选择图片文件");
  }

  const imageRuntime = runtime ?? defaultRuntime;
  const sourceDimensions = await imageRuntime.readDimensions(file, signal);
  throwIfAborted(signal);
  const plan = getCompressionPlan({
    width: sourceDimensions.width,
    height: sourceDimensions.height,
    highQuality,
  });
  const reportFile = await imageRuntime.compress(file, {
    ...plan,
    useWebWorker: true,
    signal,
  });
  throwIfAborted(signal);
  const reportDimensions = await imageRuntime.readDimensions(reportFile, signal);
  const thumbnailFile = await imageRuntime.compress(reportFile, {
    maxWidthOrHeight: 320,
    initialQuality: 0.8,
    fileType: "image/jpeg",
    useWebWorker: true,
    signal,
  });
  throwIfAborted(signal);
  const thumbnailDimensions = await imageRuntime.readDimensions(thumbnailFile, signal);
  if (Math.max(thumbnailDimensions.width, thumbnailDimensions.height) > 320) {
    throw new Error("缩略图尺寸超过 320 像素");
  }

  return {
    imageBlob: reportFile,
    thumbnailBlob: thumbnailFile,
    ...reportDimensions,
    highQuality,
  };
}
