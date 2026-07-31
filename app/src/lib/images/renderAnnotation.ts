import {
  parseAnnotationJson,
  type AnnotationShape,
} from "../../domain/inspection";

export type PixelAnnotationShape = AnnotationShape;

export interface DecodedAnnotationImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

export interface AnnotationRenderRuntime {
  decode(blob: Blob): Promise<DecodedAnnotationImage>;
  createCanvas(width: number, height: number): HTMLCanvasElement;
  encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob>;
}

export function scaleAnnotationShapes(
  shapes: AnnotationShape[],
  width: number,
  height: number,
): PixelAnnotationShape[] {
  return shapes.map((shape) => {
    if (shape.type === "ellipse") {
      return {
        ...shape,
        x: shape.x * width,
        y: shape.y * height,
        width: shape.width * width,
        height: shape.height * height,
      };
    }
    if (shape.type === "arrow") {
      return {
        ...shape,
        points: shape.points.map((point, index) => point * (index % 2 === 0 ? width : height)),
      };
    }
    return { ...shape, x: shape.x * width, y: shape.y * height };
  });
}

async function decodeImage(blob: Blob): Promise<DecodedAnnotationImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(blob);
  return new Promise<DecodedAnnotationImage>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取待标注照片"));
    };
    image.src = objectUrl;
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("照片标注渲染失败"));
    }, "image/jpeg", quality);
  });
}

const browserRuntime: AnnotationRenderRuntime = { decode: decodeImage, createCanvas, encodeJpeg };

function drawArrow(context: CanvasRenderingContext2D, points: number[]): void {
  const [startX, startY, endX, endY] = points;
  const angle = Math.atan2(endY - startY, endX - startX);
  const head = Math.max(18, context.lineWidth * 4);
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(
    endX - head * Math.cos(angle - Math.PI / 6),
    endY - head * Math.sin(angle - Math.PI / 6),
  );
  context.lineTo(
    endX - head * Math.cos(angle + Math.PI / 6),
    endY - head * Math.sin(angle + Math.PI / 6),
  );
  context.closePath();
  context.fill();
}

function drawAnnotations(
  context: CanvasRenderingContext2D,
  shapes: PixelAnnotationShape[],
  width: number,
  height: number,
): void {
  context.lineWidth = Math.max(4, Math.min(width, height) * 0.008);
  context.font = `${Math.max(24, Math.round(Math.min(width, height) * 0.045))}px Microsoft YaHei`;
  for (const shape of shapes) {
    context.strokeStyle = shape.color;
    context.fillStyle = shape.color;
    if (shape.type === "ellipse") {
      context.beginPath();
      context.ellipse(
        shape.x + shape.width / 2,
        shape.y + shape.height / 2,
        shape.width / 2,
        shape.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    } else if (shape.type === "arrow") {
      drawArrow(context, shape.points);
    } else {
      context.fillText(shape.text, shape.x, shape.y);
    }
  }
}

export async function renderAnnotation(
  sourceBlob: Blob,
  annotationJson: string | null,
  runtime: AnnotationRenderRuntime = browserRuntime,
): Promise<Blob> {
  const annotations = parseAnnotationJson(annotationJson);
  if (annotations.length === 0 && sourceBlob.type === "image/jpeg") return sourceBlob;

  const decoded = await runtime.decode(sourceBlob);
  try {
    const canvas = runtime.createCanvas(decoded.width, decoded.height);
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持照片标注渲染");
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
    drawAnnotations(
      context,
      scaleAnnotationShapes(annotations, decoded.width, decoded.height),
      decoded.width,
      decoded.height,
    );
    const jpeg = await runtime.encodeJpeg(canvas, 0.92);
    if (jpeg.type !== "image/jpeg") throw new Error("照片标注必须输出JPEG格式");
    return jpeg;
  } finally {
    decoded.close();
  }
}
