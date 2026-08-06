# Word Photo Fixed Portrait Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every photo in generated Word reports occupy the same 3:4 portrait frame while preserving the existing 2-or-3-columns-per-row setting and leaving original photos unchanged.

**Architecture:** Keep the change inside the Word export boundary. `generateDocx.ts` will calculate one fixed image width and height for each report table, then pass those exact dimensions to every `ImageRun`; annotation rendering, Word-only compression, DOCX media replacement, photo order, and source-photo persistence remain unchanged. The existing DOCX integration test will assert the exported geometry rather than the source aspect ratio.

**Tech Stack:** React/TypeScript, `docx` 9.7.1, JSZip, Vitest 4, Vite 8, pnpm.

## Global Constraints

- Word output uses a fixed `3 / 4` width-to-height frame because the user's photos are predominantly portrait.
- Horizontal and vertical photos are stretched non-uniformly to fill the frame; no crop and no letterbox are added.
- Only the Word export copy changes; original Blob data, IndexedDB, Android `Pictures/7S巡检`, annotations before export, preview rendering, and Word JPEG compression remain unchanged.
- Existing `photoLayoutMode`, `photosPerRow`, photo order, three report categories, and photo media budget remain unchanged.
- Do not add dependencies, schema fields, database migrations, or a settings UI for this focused change.
- Run commands from `PROJECT_ROOT/app` with the repository's existing pnpm toolchain.

---

## File Map

- Modify: `app/src/features/reports/generateDocx.ts:29-31,192-246` to replace per-photo aspect-preserving dimensions with one fixed 3:4 frame size per table.
- Modify: `app/src/features/reports/generateDocx.test.ts:90-114,272-297` to keep mixed-orientation fixtures and assert identical 3:4 DOCX extents for both 2-column and 3-column layouts.
- Create: no new production files, test files, dependencies, schema fields, or migration files.

## Task 1: Change The DOCX Layout Test First

**Files:**
- Modify: `app/src/features/reports/generateDocx.test.ts:90-114` (keep the existing `layoutModel` fixture with portrait, landscape, and square inputs).
- Modify: `app/src/features/reports/generateDocx.test.ts:272-297` (replace the source-aspect-ratio assertion).

**Interfaces:**
- Consumes: existing `layoutModel(photosPerRow: 2 | 3)` and `generateDocx(model, onProgress)`.
- Produces: a failing integration test proving that every exported drawing in a mixed-orientation row has the same 3:4 geometry.

- [x] **Step 1: Replace the test title and output assertions.**

Change the test title to `divides the exact content width into %i columns and uses a fixed 3:4 photo frame`, keep the existing `gridWidths` assertions, and replace the `extents.forEach` source-ratio loop with:

```ts
expect(extents).toHaveLength(photosPerRow);
expect(new Set(extents.map(({ width, height }) => String(width) + "x" + String(height))).size).toBe(1);
const firstExtent = extents[0]!;
expect(firstExtent.width / firstExtent.height).toBeCloseTo(3 / 4, 3);
```

The fixture must continue to contain a portrait photo (`600 x 1200`), a landscape photo (`1600 x 800`), and a square photo (`900 x 900`) so the assertion proves that source orientation no longer determines the Word frame.

- [x] **Step 2: Run the focused test and verify it fails for the intended reason.**

Run from `C:\Users\xj\Desktop\7s管理\app`:

```powershell
pnpm test:run src/features/reports/generateDocx.test.ts
```

Expected result before production code changes: the test fails at the fixed `3 / 4` assertion because the current implementation emits source-dependent ratios (`600/1200`, `1600/800`, and `900/900`). Existing unrelated report-generation tests should remain listed separately rather than producing a TypeScript or import failure.

- [x] **Step 3: Review the failing diff.**

Run:

```powershell
git diff -- app/src/features/reports/generateDocx.test.ts
```

Confirm that only the layout expectation changed and that no source-photo, annotation, compression, or media-reference test was removed.

## Task 2: Implement The Fixed 3:4 Frame

**Files:**
- Modify: `app/src/features/reports/generateDocx.ts:29-31` to define the Word-only frame ratio.
- Modify: `app/src/features/reports/generateDocx.ts:202-221` to calculate one frame height from the table cell width and use it for every `ImageRun`.

**Interfaces:**
- Consumes: existing `ReportModel`, `PreparedPhoto`, `columnsForPhotoCount`, page margins, photo gap, and table column calculations.
- Produces: every non-empty DOCX table cell receives an `ImageRun` with the same `{ width, height }` for that table, where `width / height` is `3 / 4`.

- [x] **Step 1: Add the named Word frame ratio constant.**

Near the existing A4 constants in `generateDocx.ts`, add:

```ts
const docxPhotoFrameAspectRatio = 3 / 4;
```

Keep the constant private to the Word generator because this behavior is intentionally not a persisted user setting.

- [x] **Step 2: Replace aspect-preserving size calculation with fixed frame dimensions.**

In `imageTable`, keep the existing `cellWidthMm`, `gapTwips`, `columnWidths`, and `imageWidthPx` calculations. Replace the full-page `imageHeightPx` calculation and the per-photo `scale`, `width`, and `height` calculation with:

```ts
const imageHeightPx = Math.max(
  1,
  imageWidthPx / docxPhotoFrameAspectRatio,
);
```

Inside the non-empty photo branch, use:

```ts
const width = imageWidthPx;
const height = imageHeightPx;
```

Leave `photo.data`, `photo.type`, `photo.id`, cell margins, centered paragraphs, `cantSplit`, and fixed table layout unchanged. Do not read `photo.width` or `photo.height` for Word geometry after this change.

- [x] **Step 3: Run the focused test and verify it passes.**

Run:

```powershell
pnpm test:run src/features/reports/generateDocx.test.ts
```

Expected result: all tests in `generateDocx.test.ts` pass, including the mixed-orientation 2-column and 3-column geometry cases, annotation ordering, compressor ordering, photo references, and the 80-photo media budget.

- [x] **Step 4: Inspect the implementation diff for scope.**

Run:

```powershell
git diff -- app/src/features/reports/generateDocx.ts app/src/features/reports/generateDocx.test.ts
```

Confirm the diff contains only the named frame ratio, fixed height/width assignment, and the test expectation update. No template, database, photo persistence, or compression files should appear.

## Task 3: Full Verification And Delivery Check

**Files:**
- Test: `app/src/features/reports/generateDocx.test.ts`
- Test: `app/src/features/reports/generateDocx.stress.test.ts`
- Build metadata: `app/package.json` scripts only; do not modify it.

**Interfaces:**
- Consumes: the implementation and tests from Tasks 1-2.
- Produces: verified Word generation behavior with no regression in the full web application test/build surface.

- [x] **Step 1: Run the full Vitest suite with one worker.**

Run from `C:\Users\xj\Desktop\7s管理\app`:

```powershell
pnpm test:run -- --maxWorkers=1
```

Observed result: both full-suite runs reached 45/46 files and 539/540 tests; each failed on a different unrelated asynchronous/flaky test (`excelImport.test.ts` timeout, then `route-selection.test.tsx` state race). The Word-focused tests remained green.

- [x] **Step 2: Run the stress suite.**

Run:

```powershell
pnpm test:stress -- --maxWorkers=1
```

Expected result: the 100-photo streaming/reference stress test passes and still reports complete photo references, bounded streaming chunks, sequential rendering, and final progress phases.

- [x] **Step 3: Run lint and production build.**

Run:

```powershell
pnpm lint
pnpm build
```

Expected result: both commands exit with code 0, with no TypeScript errors, lint errors, or Vite build errors.

- [x] **Step 4: Run final repository checks.**

Run from `C:\Users\xj\Desktop\7s管理`:

```powershell
git diff --check
git --no-optional-locks status --short --branch
git log -1 --oneline --decorate
```

Expected result: no whitespace errors; after the implementation commits, only this untracked plan file remains outside HEAD.

- [x] **Step 5: Commit the implementation.**

Stage only the two implementation files and create one focused commit:

```powershell
git add -- app/src/features/reports/generateDocx.ts app/src/features/reports/generateDocx.test.ts
git commit -m "feat: use fixed portrait Word photo frames"
```

Observed commits: `6c5eb09` contains the fixed 3:4 Word geometry and regression test; `5acb3d2` removes the obsolete unused fixture binding. No release or APK changes were made.
