# Word Photo Size Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress only the images embedded in generated Word reports so reports with 70-80 photos stay under 8 MiB when the source photos permit it, while preserving source photos and annotations.

**Architecture:** Add a focused Word-photo compressor around the existing `browser-image-compression` dependency. `generateDocx` will render annotations first, calculate one per-photo target from the report photo count, then pass the rendered JPEG through the compressor before the existing sequential ZIP media replacement. The compressor is injectable for deterministic tests; omitted test compressors use the browser default, while the stress test uses an explicit passthrough.

**Tech Stack:** TypeScript, Vitest, `browser-image-compression`, `docx`, JSZip, existing sequential ZIP writer.

## Global Constraints

- Keep the DOCX final target at `8 * 1024 * 1024` bytes.
- Reserve approximately `0.8 MiB` for DOCX XML and ZIP structure; use approximately `7.2 MiB` for embedded photo media.
- Use a `700 KiB` per-photo cap for small reports and a `90 KiB` per-photo floor for the supported 70-80 photo range.
- Render annotations before Word-only compression.
- Never mutate or replace IndexedDB images, Android gallery originals, preview images, or annotation source images.
- Keep JPEG output, aspect ratio, existing Word layout, progress reporting, ZIP32 checks, and photo relationship checks unchanged.
- Do not change the released `v1.0.2` tag or upload anything during implementation.
- Run full Vitest with one worker: `pnpm exec vitest run --maxWorkers=1`.

---

### Task 1: Add the Word Photo Budget and Compressor

**Files:**
- Create: `app/src/lib/images/compressDocxPhoto.ts`
- Create: `app/src/lib/images/compressDocxPhoto.test.ts`

**Interfaces:**
- Produces `DOCX_PHOTO_MEDIA_BUDGET`, `DOCX_MAX_PHOTO_BYTES`, `DOCX_MIN_PHOTO_BYTES`, `getDocxPhotoBudget(photoCount)`, and `compressDocxPhoto(sourceBlob, targetBytes, runtime?)`.
- `getDocxPhotoBudget(photoCount)` returns `{ mediaBudgetBytes: number; targetBytes: number; maxWidthOrHeight: number }`.
- `compressDocxPhoto` accepts a `Blob`, a byte target, and an optional `{ compress(file, options): Promise<File> }` runtime, and returns a JPEG `Blob` without modifying the source Blob.

- [ ] **Step 1: Write failing budget and compression tests**

Add tests with these behaviors:

```ts
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
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run from `app`:

```bash
pnpm exec vitest run src/lib/images/compressDocxPhoto.test.ts
```

Expected: FAIL because `compressDocxPhoto.ts` and its exported budget functions do not exist yet. If the suite errors due to a test typo instead of missing behavior, fix only the test and rerun until the failure is the missing implementation.

- [ ] **Step 3: Implement the minimal budget and bounded compressor**

Create `compressDocxPhoto.ts` with this implementation shape:

```ts
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
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run src/lib/images/compressDocxPhoto.test.ts
```

Expected: all compressor tests PASS. The test must prove that a small JPEG is returned by identity, a large JPEG receives bounded attempts, the final output is JPEG, and the source bytes remain unchanged.

- [ ] **Step 5: Commit the compressor unit**

```bash
git add app/src/lib/images/compressDocxPhoto.ts app/src/lib/images/compressDocxPhoto.test.ts
git commit -m "feat: add Word photo size budget compressor"
```

### Task 2: Apply the Compressor to DOCX Generation

**Files:**
- Modify: `app/src/features/reports/generateDocx.ts`
- Modify: `app/src/features/reports/generateDocx.test.ts`
- Modify: `app/src/features/reports/generateDocx.stress.test.ts`

**Interfaces:**
- `DocxGenerationRuntime` gains optional `compressForDocx(sourceBlob: Blob, targetBytes: number): Promise<Blob>`.
- The browser default runtime uses `compressDocxPhoto`.
- `generateDocx` calculates `getDocxPhotoBudget(reportPhotos.length)` once and compresses each annotation-rendered Blob before ZIP replacement.

- [ ] **Step 1: Add failing DOCX integration tests**

Add a helper to `generateDocx.test.ts` that sums actual media bytes:

```ts
async function embeddedMediaBytes(blob: Blob): Promise<number> {
  const zip = await JSZip.loadAsync(blob);
  const media = zip.file(/^word\/media\//);
  const sizes = await Promise.all(media.map(async (file) => (await file.async("uint8array")).byteLength));
  return sizes.reduce((total, size) => total + size, 0);
}
```

Add these tests before writing production changes:

```ts
test("passes annotated output to the Word compressor before packaging", async () => {
  const model = fivePhotoModel();
  const photo = model.sections[0].groups[0].photos[0];
  const rendered = new Blob(["rendered-jpeg"], { type: "image/jpeg" });
  const compressed = new Blob(["compressed-jpeg"], { type: "image/jpeg" });
  const renderAnnotation = vi.fn().mockResolvedValue(rendered);
  const compressForDocx = vi.fn().mockResolvedValue(compressed);

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined, {
    renderAnnotation,
    compressForDocx,
  }));

  expect(renderAnnotation).toHaveBeenCalledWith(photo.imageBlob, photo.annotationJson);
  expect(compressForDocx).toHaveBeenCalledWith(rendered, expect.any(Number));
  await expect(zip.file(/^word\/media\//)[0].async("string")).resolves.toBe("compressed-jpeg");
});

test("keeps an 80-photo DOCX media payload within the configured budget", async () => {
  const photoIds = Array.from({ length: 80 }, (_, index) => `budget-photo-${index + 1}`);
  const inspection = makeInspection({ templateVersion: 1 });
  const template = makeTemplate();
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({ photoIds })],
    photos: photoIds.map((id, index) => makePhoto(
      new Blob([`source-${index}`], { type: "image/jpeg" }),
      { id, order: index, width: 1200, height: 800 },
    )),
    template,
  }, template);
  const compressForDocx = vi.fn(async (_source: Blob, targetBytes: number) =>
    new Blob([new Uint8Array(targetBytes).fill(3)], { type: "image/jpeg" }));

  const blob = await generateDocx(model, () => undefined, {
    renderAnnotation: async (source) => source,
    compressForDocx,
  });

  const { DOCX_PHOTO_MEDIA_BUDGET, getDocxPhotoBudget } = await import("../../lib/images/compressDocxPhoto");
  expect(compressForDocx).toHaveBeenCalledTimes(80);
  expect(await embeddedMediaBytes(blob)).toBeLessThanOrEqual(DOCX_PHOTO_MEDIA_BUDGET);
  expect(blob.size).toBeLessThan(8 * 1024 * 1024);
  expect(compressForDocx).toHaveBeenCalledWith(expect.any(Blob), getDocxPhotoBudget(80).targetBytes);
});
```

- [ ] **Step 2: Run the new integration tests and verify RED**

Run:

```bash
pnpm exec vitest run src/features/reports/generateDocx.test.ts
```

Expected: the new tests fail because the runtime does not yet call `compressForDocx`; existing tests should continue to pass. If the 80-photo test fails for a fixture/setup reason, correct the test before production changes.

- [ ] **Step 3: Wire the compressor into `generateDocx`**

Make these focused changes:

```ts
import {
  compressDocxPhoto,
  getDocxPhotoBudget,
} from "../../lib/images/compressDocxPhoto";

export interface DocxGenerationRuntime {
  renderAnnotation(sourceBlob: Blob, annotationJson: string | null): Promise<Blob>;
  compressForDocx?(sourceBlob: Blob, targetBytes: number): Promise<Blob>;
}

const browserGenerationRuntime: DocxGenerationRuntime = {
  renderAnnotation,
  compressForDocx: compressDocxPhoto,
};
```

Inside `generateDocx`, immediately after `totalImages`:

```ts
const photoBudget = getDocxPhotoBudget(totalImages);
const compressForDocx = runtime.compressForDocx ?? compressDocxPhoto;
```

Replace the current replacement callback body with:

```ts
replacements.set(mediaPath, async () => {
  const rendered = await runtime.renderAnnotation(photo.imageBlob, photo.annotationJson);
  if (rendered.type !== "image/jpeg") throw new Error(`照片 ${photo.id} 未渲染为JPEG。`);
  const compressed = await compressForDocx(rendered, photoBudget.targetBytes);
  if (compressed.type !== "image/jpeg") throw new Error(`照片 ${photo.id} 未压缩为JPEG。`);
  return compressed;
});
```

Do not change the existing `replaceZipMediaSequentially` call or its progress callbacks.

- [ ] **Step 4: Update the stress runtime and run DOCX tests**

In `generateDocx.stress.test.ts`, add an explicit passthrough so the stress test continues testing large sequential ZIP writes without browser image decoding:

```ts
compressForDocx: async (source) => source,
```

Run:

```bash
pnpm exec vitest run src/features/reports/generateDocx.test.ts src/features/reports/generateDocx.stress.test.ts
```

Expected: all DOCX tests PASS, including complete references, annotation ordering, 80-photo media budget, 100-photo streaming, and progress ordering.

- [ ] **Step 5: Commit DOCX integration**

```bash
git add app/src/features/reports/generateDocx.ts app/src/features/reports/generateDocx.test.ts app/src/features/reports/generateDocx.stress.test.ts
git commit -m "feat: apply photo budget to Word reports"
```

### Task 3: Full Verification and Release Boundary Check

**Files:**
- Modify: none unless a test exposes a behavior regression.
- Inspect: `git status`, `git log`, `app/package.json`, `output/`.

- [ ] **Step 1: Run the full single-worker test suite**

```bash
pnpm exec vitest run --maxWorkers=1
```

Expected: all test files and cases pass with no unhandled errors.

- [ ] **Step 2: Run lint and production build**

```bash
pnpm lint
pnpm build
```

Expected: both commands exit successfully.

- [ ] **Step 3: Run the stress configuration**

```bash
pnpm test:stress
```

Expected: the 100-photo stress case passes with sequential rendering and bounded streaming behavior.

- [ ] **Step 4: Verify source preservation and release boundary**

```bash
git status --short --branch
git log --oneline --decorate -6
git tag --list "v1.0.1" "v1.0.2"
```

Expected: only intended source/tests/docs changes exist, `v1.0.1` and `v1.0.2` remain present and unchanged, and no upload or APK release is performed for this request.
