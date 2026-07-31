import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import {
  getCompressionPlan,
  processImage,
  type ImageProcessingRuntime,
} from "./compressImage";

test("uses 2000px and 0.85 quality by default", () => {
  expect(getCompressionPlan({ width: 4032, height: 3024, highQuality: false })).toEqual({
    maxWidthOrHeight: 2000,
    initialQuality: 0.85,
    fileType: "image/jpeg",
  });
});

test("keeps the original maximum dimension in high quality mode", () => {
  expect(
    getCompressionPlan({ width: 4032, height: 3024, highQuality: true }).maxWidthOrHeight,
  ).toBe(4032);
});

test("rejects files that are not images with a Chinese message", async () => {
  const file = new File(["not an image"], "notes.txt", { type: "text/plain" });

  await expect(processImage(file, { highQuality: false })).rejects.toThrow(
    "只能选择图片文件",
  );
});

test("returns dimensions decoded from the final JPEG and forwards the abort signal", async () => {
  expect(processImage).toHaveLength(3);
  const bytes = readFileSync(resolve("tests/fixtures/site-photo.jpg"));
  const file = new File([bytes], "site-photo.jpg", { type: "image/jpeg" });
  const reportFile = new File([bytes], "report.jpg", { type: "image/jpeg" });
  const thumbnailFile = new File([bytes], "thumbnail.jpg", { type: "image/jpeg" });
  const controller = new AbortController();
  const runtime: ImageProcessingRuntime = {
    compress: vi.fn()
      .mockResolvedValueOnce(reportFile)
      .mockResolvedValueOnce(thumbnailFile),
    readDimensions: vi.fn()
      .mockResolvedValueOnce({ width: 4032, height: 3024 })
      .mockResolvedValueOnce({ width: 1998, height: 1499 })
      .mockResolvedValueOnce({ width: 320, height: 240 }),
  };

  const result = await processImage(
    file,
    { highQuality: false, signal: controller.signal },
    runtime,
  );

  expect(result).toMatchObject({ width: 1998, height: 1499, highQuality: false });
  expect(runtime.compress).toHaveBeenNthCalledWith(1, file, expect.objectContaining({
    maxWidthOrHeight: 2000,
    signal: controller.signal,
  }));
  expect(runtime.compress).toHaveBeenNthCalledWith(2, reportFile, expect.objectContaining({
    maxWidthOrHeight: 320,
    signal: controller.signal,
  }));
  expect(runtime.readDimensions).toHaveBeenCalledTimes(3);
});

test("rejects a compressor result whose decoded thumbnail exceeds 320px", async () => {
  expect(processImage).toHaveLength(3);
  const file = new File(["jpeg"], "site-photo.jpg", { type: "image/jpeg" });
  const runtime: ImageProcessingRuntime = {
    compress: vi.fn()
      .mockResolvedValueOnce(file)
      .mockResolvedValueOnce(file),
    readDimensions: vi.fn()
      .mockResolvedValueOnce({ width: 2400, height: 1800 })
      .mockResolvedValueOnce({ width: 2000, height: 1500 })
      .mockResolvedValueOnce({ width: 321, height: 241 }),
  };

  await expect(processImage(file, { highQuality: false }, runtime)).rejects.toThrow(
    "缩略图尺寸超过 320 像素",
  );
});
