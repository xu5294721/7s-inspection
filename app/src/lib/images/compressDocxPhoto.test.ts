import { vi } from "vitest";
import {
  DOCX_MAX_PHOTO_BYTES,
  DOCX_MIN_PHOTO_BYTES,
  DOCX_PHOTO_MEDIA_BUDGET,
  compressDocxPhoto,
  getDocxPhotoBudget,
} from "./compressDocxPhoto";

test("allocates a capped target for small reports and a shared target for 80 photos", () => {
  expect(getDocxPhotoBudget(0)).toMatchObject({
    mediaBudgetBytes: DOCX_PHOTO_MEDIA_BUDGET,
    targetBytes: DOCX_MAX_PHOTO_BYTES,
  });
  expect(getDocxPhotoBudget(8).targetBytes).toBe(DOCX_MAX_PHOTO_BYTES);
  expect(getDocxPhotoBudget(80).targetBytes).toBe(
    Math.floor(DOCX_PHOTO_MEDIA_BUDGET / 80),
  );
  expect(getDocxPhotoBudget(80).targetBytes).toBeGreaterThanOrEqual(DOCX_MIN_PHOTO_BYTES);
});

test("returns an already-small JPEG unchanged and does not call the compressor", async () => {
  const source = new Blob([new Uint8Array(40 * 1024)], { type: "image/jpeg" });
  const runtime = { compress: vi.fn() };

  await expect(compressDocxPhoto(source, 100 * 1024, runtime)).resolves.toBe(source);
  expect(runtime.compress).not.toHaveBeenCalled();
});

test("iterates quality and dimensions until the JPEG is within the target", async () => {
  const sourceBytes = new Uint8Array(300 * 1024).fill(7);
  const source = new Blob([sourceBytes], { type: "image/jpeg" });
  const outputs = [
    new File([new Uint8Array(180 * 1024)], "out.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(120 * 1024)], "out.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(80 * 1024)], "out.jpg", { type: "image/jpeg" }),
  ];
  const runtime = { compress: vi.fn()
    .mockResolvedValueOnce(outputs[0])
    .mockResolvedValueOnce(outputs[1])
    .mockResolvedValueOnce(outputs[2]) };

  const result = await compressDocxPhoto(source, 100 * 1024, runtime);

  expect(result).toBe(outputs[2]);
  expect(result.type).toBe("image/jpeg");
  expect(result.size).toBeLessThanOrEqual(100 * 1024);
  expect(runtime.compress).toHaveBeenCalledTimes(3);
  expect(runtime.compress).toHaveBeenNthCalledWith(1, expect.any(File), expect.objectContaining({
    maxWidthOrHeight: 1600,
    initialQuality: 0.82,
    fileType: "image/jpeg",
    maxSizeMB: (100 * 1024) / (1024 * 1024),
    useWebWorker: true,
  }));
  expect(runtime.compress).toHaveBeenNthCalledWith(3, expect.any(File), expect.objectContaining({
    maxWidthOrHeight: 1400,
    initialQuality: 0.56,
  }));
  expect(await source.arrayBuffer()).toEqual(sourceBytes.buffer);
});

test("returns the smallest JPEG available after bounded attempts", async () => {
  const source = new Blob([new Uint8Array(300 * 1024)], { type: "image/jpeg" });
  const outputs = [
    new File([new Uint8Array(240 * 1024)], "out.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(160 * 1024)], "out.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(120 * 1024)], "out.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(110 * 1024)], "out.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(100 * 1024)], "out.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(90 * 1024)], "out.jpg", { type: "image/jpeg" }),
  ];
  const runtime = { compress: vi.fn()
    .mockResolvedValueOnce(outputs[0])
    .mockResolvedValueOnce(outputs[1])
    .mockResolvedValueOnce(outputs[2])
    .mockResolvedValueOnce(outputs[3])
    .mockResolvedValueOnce(outputs[4])
    .mockResolvedValueOnce(outputs[5]) };

  const result = await compressDocxPhoto(source, 80 * 1024, runtime);

  expect(result).toBe(outputs[5]);
  expect(runtime.compress).toHaveBeenCalledTimes(6);
});

test("rejects a non-JPEG compressor result", async () => {
  const source = new Blob([new Uint8Array(300 * 1024)], { type: "image/jpeg" });
  const runtime = { compress: vi.fn().mockResolvedValue(
    new File(["png"], "out.png", { type: "image/png" }),
  ) };

  await expect(compressDocxPhoto(source, 80 * 1024, runtime)).rejects.toThrow(
    "Word照片压缩未输出JPEG",
  );
});
