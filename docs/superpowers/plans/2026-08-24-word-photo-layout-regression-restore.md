# Word Photo Layout Regression Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the stable Word photo layout shown in the user's reference pages by removing context-dependent first-page enlargement and the special two-photo height.

**Architecture:** Keep the existing atomic photo-item table and page estimator. Make adaptive frame selection depend only on photo count: one photo uses a centered `150 x 100 mm` frame; every multi-photo item uses equal `78 x 58 mm` frames in a maximum two-column grid. Delete all first-page/next-item sizing branches so pagination can move complete blocks but can never resize them.

**Tech Stack:** TypeScript, `docx` 9.7.1, JSZip, Vitest, LibreOffice headless renderer.

## Global Constraints

- Work only in `C:/Users/xj/Desktop/7s管理/.worktrees/git-canonical` on branch `codex/git-canonical`.
- Preserve the unrelated modification in `.superpowers/sdd/task-1-report.md`.
- Preserve the outer one-row `cantSplit` item block, the 2+1 three-photo grid, the 2x2 four-photo grid, photo order, annotations, media replacement, and compression.
- Adaptive single-photo frames are always `150 x 100 mm`, independent of page number, remaining space, source orientation, and following items.
- Adaptive multi-photo frames are always `78 x 58 mm`, including exactly two photos.
- A complete item that does not fit moves to the next page; no layout code may enlarge or shrink a frame based on remaining page height.
- Do not change original photo blobs, persisted inspection data, mobile preview, user-facing settings, or fixed-layout mode.
- Do not change Android version metadata or build an APK unless separately requested.
- Render a representative DOCX and inspect every output page before claiming completion.

---

### Task 1: Define stable adaptive frame regressions

**Files:**
- Modify: `C:/Users/xj/Desktop/7s管理/.worktrees/git-canonical/app/src/features/reports/generateDocx.test.ts`

**Interfaces:**
- Consumes: `adaptiveLayoutModel`, `firstPageFillModel`, `drawingExtents`, and `generateDocx`.
- Produces: tests proving that page context cannot change adaptive frame dimensions.

- [x] **Step 1: Replace first-page enlargement expectations.**

Update the single-photo first-page tests to require exactly the same `150 x 100 mm` extent for ordinary and sparse first-page reports, including extreme portrait source photos.

- [x] **Step 2: Replace the two-photo special-height expectation.**

Update the adaptive photo-count test so photo counts `2`, `3`, and `4` all require `78 x 58 mm` frames.

- [x] **Step 3: Add context-invariance assertions.**

Generate equivalent one-photo and two-photo groups with and without front matter and assert their `wp:extent` values are equal. Keep the existing assertions that three photos use 2+1 and four photos use 2x2.

- [x] **Step 4: Run the focused test file and confirm RED.**

Run `pnpm exec vitest run src/features/reports/generateDocx.test.ts --maxWorkers=1` from `app/`. Expected: failures reference current `150 x 120 mm` first-page frames and `78 x 70 mm` two-photo frames.

- [x] **Step 5: Commit the test-only regression.**

Commit only `app/src/features/reports/generateDocx.test.ts` with message `test: restore stable Word photo frames`.

---

### Task 2: Remove context-dependent photo sizing

**Files:**
- Modify: `C:/Users/xj/Desktop/7s管理/.worktrees/git-canonical/app/src/features/reports/generateDocx.ts`
- Test: `C:/Users/xj/Desktop/7s管理/.worktrees/git-canonical/app/src/features/reports/generateDocx.test.ts`

**Interfaces:**
- Consumes: `photoTableLayout(model, photos)` and `photoGroupBlockHeightTwips(model, groupText, layout)`.
- Produces: one deterministic `adaptiveFrameForPhotoCount(photoCount)` result with no page-context override.

- [x] **Step 1: Centralize the stable dimensions.**

Set `adaptiveSingleFrameWidthMm = 150`, `adaptiveSingleFrameHeightMm = 100`, `adaptiveGridFrameWidthMm = 78`, and `adaptiveGridFrameHeightMm = 58`. Remove `adaptiveTwoPhotoFrameHeightMm` and every `firstPage*` frame/safety constant.

- [x] **Step 2: Simplify adaptive frame selection.**

Make `adaptiveFrameForPhotoCount()` choose only between the single frame and grid frame. Remove the optional `adaptiveFrameOverride` parameter from `photoTableLayout()`.

- [x] **Step 3: Delete the first-page sizing branch.**

Remove `firstPageAdaptiveLayout()`, `PageLayoutEstimator.firstPage`, `isOnFirstPage()`, `firstPhotoGroupIndex`, and the next-group look-ahead used only for photo sizing. Every photo-backed group must call `photoTableLayout(model, preparedPhotos)` directly.

- [x] **Step 4: Preserve atomic pagination.**

Keep `photoGroupBlock()`, `photoGroupBlockHeightTwips()`, `groupPageBreak`, section-heading binding, and `pagination.consume(groupHeight)` unchanged except for references made obsolete by Step 3.

- [x] **Step 5: Run the focused test file and confirm GREEN.**

Run `pnpm exec vitest run src/features/reports/generateDocx.test.ts --maxWorkers=1`. Expected: all tests pass with no first-page enlargement or two-photo height exception.

- [x] **Step 6: Commit the implementation.**

Commit `app/src/features/reports/generateDocx.ts` and any necessary test cleanup with message `fix: restore stable Word photo layout`.

---

### Task 3: Verify DOCX structure, rendering, and project health

**Files:**
- Create temporary QA artifacts only under `C:/Users/xj/Desktop/7s管理/.worktrees/git-canonical/tmp/docs/word-photo-layout-regression/`.
- Update: `C:/Users/xj/Desktop/7s管理/.worktrees/git-canonical/docs/superpowers/plans/2026-08-24-word-photo-layout-regression-restore.md`

**Interfaces:**
- Consumes: the completed `generateDocx()` implementation and representative landscape/portrait JPEG fixtures.
- Produces: a rendered DOCX/PDF/PNG QA record and full verification results.

- [x] **Step 1: Generate a representative DOCX.**

Create a temporary report containing one-photo, two-photo, three-photo, four-photo, and page-boundary items. Use valid JPEG fixtures and verify that every input photo has a DOCX media relationship.

- [x] **Step 2: Render and inspect every page.**

Use the documents skill `render_docx.py` or LibreOffice headless conversion. Inspect every page PNG at 100% and confirm: captions remain with photos; single frames are consistent; all multi-photo frames are consistent; 3-photo layout is 2+1; 4-photo layout is 2x2; no photo frame changes because of page position; no clipping or overlap occurs.

- [x] **Step 3: Run complete verification.**

From `app/`, run `pnpm exec vitest run --maxWorkers=1`, `pnpm run lint`, and `pnpm run build`. Expected: zero failed tests, lint exit code 0, and build exit code 0.

- [x] **Step 4: Record evidence and commit the plan update.**

## Verification Evidence (Task 3)

- Representative artifact: `tmp/docs/word-photo-layout-regression/word-photo-layout-regression-qa.docx`.
- Structural evidence: `tmp/docs/word-photo-layout-regression/structure-evidence.json`; 15 valid JPEG inputs produced 15 DOCX media relationships. Extents are one-photo `5400675 x 3600450` EMU (`150 x 100 mm`) and every multi-photo frame `2809875 x 2085975` EMU (`78 x 58 mm`); photo order is preserved.
- Rendering: the packaged `render_docx.py --emit_pdf --verbose` could not start because the environment lacks Python `pdf2image`. LibreOffice headless conversion was used instead to produce a four-page `representative.pdf`; `pages/page-1.png` through `page-4.png` were inspected at 100%: page 1 keeps the caption with its single frame; page 2 shows two equal frames and a 2+1 three-photo grid without overlap; page 3 shows a 2x2 four-photo grid and a complete single-photo boundary item; page 4 contains only the closing signature block with no clipping.
- `app/`: `pnpm exec vitest run --maxWorkers=1 --no-file-parallelism --retry=1` passed (`51` files, `634` tests); `pnpm run lint` exited `0`; `pnpm run build` exited `0` (Vite emitted only the existing large-chunk warning).

Mark completed checkboxes and record the rendered page count plus verification command results. Commit only this plan file with message `docs: record Word photo layout verification`.

## Plan Self-Review

- Spec coverage: stable single/multi frames, atomic pagination, 2+1 and 2x2 grids, source-data preservation, and visual verification are covered.
- Placeholder scan: no `TBD`, `TODO`, or unresolved behavior remains.
- Type consistency: `photoTableLayout` has one deterministic signature and all pagination calculations consume its returned layout.
