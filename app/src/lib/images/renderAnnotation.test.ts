import { vi } from "vitest";
import type { AnnotationShape } from "../../domain/inspection";
import {
  renderAnnotation,
  scaleAnnotationShapes,
  type AnnotationRenderRuntime,
} from "./renderAnnotation";

test("scales normalized shapes to source pixels", () => {
  const shapes: AnnotationShape[] = [
    { type: "ellipse", x: 0.1, y: 0.2, width: 0.3, height: 0.4, color: "#d12f2f" },
    { type: "arrow", points: [0.1, 0.2, 0.8, 0.9], color: "#d12f2f" },
    { type: "text", x: 0.5, y: 0.25, text: "问题", color: "#d12f2f" },
  ];

  expect(scaleAnnotationShapes(shapes, 1200, 800)).toEqual([
    { type: "ellipse", x: 120, y: 160, width: 360, height: 320, color: "#d12f2f" },
    { type: "arrow", points: [120, 160, 960, 720], color: "#d12f2f" },
    { type: "text", x: 600, y: 200, text: "问题", color: "#d12f2f" },
  ]);
});

test("renders JPEG on a canvas with the source aspect ratio", async () => {
  const context = {
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    set strokeStyle(_value: string) {},
    set fillStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set font(_value: string) {},
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  const close = vi.fn();
  const runtime: AnnotationRenderRuntime = {
    decode: vi.fn().mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 1200,
      height: 800,
      close,
    }),
    createCanvas: vi.fn(() => canvas),
    encodeJpeg: vi.fn().mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" })),
  };
  const annotationJson = JSON.stringify([
    { type: "ellipse", x: 0.1, y: 0.2, width: 0.3, height: 0.4, color: "#d12f2f" },
  ]);

  const result = await renderAnnotation(
    new Blob(["source"], { type: "image/jpeg" }),
    annotationJson,
    runtime,
  );

  expect(result.type).toBe("image/jpeg");
  expect(canvas.width / canvas.height).toBe(1.5);
  expect(context.drawImage).toHaveBeenCalled();
  expect(context.ellipse).toHaveBeenCalledWith(300, 320, 180, 160, 0, 0, Math.PI * 2);
  expect(runtime.encodeJpeg).toHaveBeenCalledWith(canvas, 0.92);
  expect(close).toHaveBeenCalledOnce();
});

test("returns the source JPEG unchanged when there are no annotations", async () => {
  const source = new Blob(["source"], { type: "image/jpeg" });
  const runtime: AnnotationRenderRuntime = {
    decode: vi.fn(),
    createCanvas: vi.fn(),
    encodeJpeg: vi.fn(),
  };

  await expect(renderAnnotation(source, null, runtime)).resolves.toBe(source);
  expect(runtime.decode).not.toHaveBeenCalled();
});
