# Word Photo Layout Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the adaptive DOCX photo layout so each inspection item is a coherent paginated block with stable horizontal frames and an aesthetic two-column grid.

**Architecture:** Keep the change inside `generateDocx.ts` and its focused test file. Replace source-ratio/page-remainder scaling with one shared fixed-frame layout model, wrap photo-backed items in a one-row outer table, and let the pagination estimator make decisions from the same block height used to build the DOCX. Preserve the existing annotation rendering, DOCX-only compression, media replacement, inspection data, and user-facing settings.

**Tech Stack:** TypeScript, `docx` 9.7.1, JSZip, Vitest, Vite, LibreOffice headless rendering.

## Global Constraints

- Preserve every report photo, including normal-item photos; keep only the existing three categories: 好的、提醒的问题、考核的问题.
- Preserve original photo blobs, IndexedDB records, Android gallery backups, annotations, and report text.
- Do not add or remove user-facing features or settings.
- In adaptive export, use a horizontal fixed frame, allow nonuniform stretch, do not crop, and do not leave blank space inside the frame.
- In adaptive export, use at most two columns: 1 photo uses one centered frame, 2 photos use one row, 3 photos use 2+1, and 4+ photos use two-column rows.
- For 1—4 photos, the item paragraph and all photos stay together; items larger than one page may continue only at complete photo-row boundaries.
- Do not shrink an item to consume page-bottom remainder.
- After a three-photo 2+1 item, continue with a following one- or two-photo item whenever the complete following block fits on the same page.
- Verify actual DOCX rendering with `C:\Program Files\LibreOffice\program\soffice.exe` before changing the Android version or claiming completion.
- Leave the existing untracked `.codex-preview/` directory untouched.

---

### Task 1: Replace outdated adaptive expectations with failing regressions

**Files:**
- Modify: `C:\Users\xj\Desktop\7s管理\app\src\features\reports\generateDocx.test.ts`
- Read: `C:\Users\xj\Desktop\7s管理\docs\superpowers\specs\2026-08-09-word-photo-layout-rework-design.md`

**Interfaces:**
- Consumes: existing `makeInspection`, `makeTemplate`, `makePhotoGroup`, `makePhoto`, `buildReportModel`, `paragraphContaining`, and XML extent helpers.
- Produces: regression expectations for adaptive fixed frames, item-level pagination, two-column grouping, and non-scaling behavior.

- [ ] **Step 1: Rename the current adaptive shrink test and invert its behavior.**

Change `test("shrinks an overflowing adaptive photo group into the remaining page space", ...)` to `test("moves an overflowing adaptive item as a complete block without shrinking its frame", ...)`. Keep the same two-item fixture, but assert:

```ts
expect(paragraphContaining(documentXml, "2. 第二项点照片。"))
  .toContain("<w:pageBreakBefore/>");
expect(new Set(extents.map(({ width, height }) => `${width}x${height}`)).size).toBe(2);
expect(extents[0]!.width).toBeGreaterThan(600_000);
expect(extents[2]!.width).toBeGreaterThan(600_000);
```

The exact threshold is only a guard that the frame remains readable; the equality and fixed dimensions are asserted in the next tests.

- [ ] **Step 2: Add a reusable adaptive frame extraction helper.**

Add this test-local helper beside the existing XML helpers:

```ts
function drawingExtents(xml: string): Array<{ width: number; height: number }> {
  return [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
}
```

Use it for the new tests so expected extents are not duplicated across tests.

- [ ] **Step 3: Add a two-photo equal-frame regression.**

Create an adaptive group with one `1600x900` photo and one `900x1600` photo. Assert the two extracted extents are identical, and assert the frame ratio is horizontal:

```ts
expect(extents).toHaveLength(2);
expect(new Set(extents.map(({ width, height }) => `${width}x${height}`)).size).toBe(1);
expect(extents[0]!.width / extents[0]!.height).toBeGreaterThan(1.2);
```

- [ ] **Step 4: Add three-photo and four-photo grid regressions.**

For three photos, assert three identical extents and a two-column table shape with the last row containing one photo. For four photos, assert four identical extents and two `cantSplit` rows inside the item block. The test must inspect the outer block and nested photo table rather than relying on a greedy flat `<w:tbl>` regex.

- [ ] **Step 5: Add the no-orphan regression.**

Build a report with a long introduction, one photo-backed item near the page bottom, and a following item. Assert that the following item’s paragraph and its first drawing occur in the same item block and that the paragraph receives `<w:pageBreakBefore/>` when the complete block does not fit.

- [ ] **Step 6: Run the focused file and confirm RED.**

Run:

```powershell
pnpm exec vitest run src/features/reports/generateDocx.test.ts
```

Expected result: the new fixed-frame and no-scaling assertions fail against the current adaptive implementation, while unrelated media and fixed-mode tests remain runnable. Do not change production code until this RED result is recorded.

- [ ] **Step 7: Commit the test-only regressions.**

```powershell
git add -- app/src/features/reports/generateDocx.test.ts
git commit -m "test: define coherent Word photo item layout"
```

---

### Task 2: Implement one fixed-frame adaptive photo-grid model

**Files:**
- Modify: `C:\Users\xj\Desktop\7s管理\app\src\features\reports\generateDocx.ts`
- Test: `C:\Users\xj\Desktop\7s管理\app\src\features\reports\generateDocx.test.ts`

**Interfaces:**
- Consumes: `ReportModel.photoLayoutMode`, `ReportModel.photosPerRow`, page margins, `photoGapPt`, and `PreparedPhoto[]`.
- Produces: `PhotoTableLayout` with fixed `PhotoPlacement` extents, fixed row heights, column widths, and `heightTwips` shared by rendering and pagination.

- [ ] **Step 1: Add centralized adaptive frame constants.**

Replace the adaptive source-ratio height constants with these centralized values:

```ts
const adaptiveSingleFrameWidthMm = 135;
const adaptiveSingleFrameHeightMm = 90;
const adaptiveGridFrameWidthMm = 78;
const adaptiveGridFrameHeightMm = 58;
const adaptiveGridMaximumColumns = 2;
const photoBlockSpacingMm = 4;
```

Keep `singlePhotoWidthMm` and `singlePhotoHeightMm` for legacy fixed mode. Do not retain `minimumAdaptivePhotoScale`, `maximumAdaptivePhotoHeightMm`, or any call path whose purpose is to fit an adaptive table into the current page remainder.

- [ ] **Step 2: Add the adaptive column and row policy.**

Implement an internal helper with this exact contract:

```ts
function adaptiveColumnsForPhotoCount(model: ReportModel, photoCount: number): number;
```

It must return `1` when `photoCount <= 1`, return `1` when the configured row limit is `1`, and otherwise return `Math.min(2, photoCount, model.photosPerRow)`. This preserves the existing one-photo/two-photo settings while keeping three- and four-photo grids at two columns.

Implement a second helper:

```ts
function adaptiveFrameForPhotoCount(photoCount: number): { width: number; height: number };
```

It returns the centered 135×90mm frame for one photo and the equal 78×58mm grid frame for every multi-photo group. Convert millimeters to pixels once and clamp both dimensions to positive integers.

- [ ] **Step 3: Change `photoTableLayout` to use fixed adaptive placements.**

For adaptive mode:

```ts
const columns = adaptiveColumnsForPhotoCount(model, photos.length);
const frame = adaptiveFrameForPhotoCount(photos.length);
const placements = photos.map(() => ({ width: frame.width, height: frame.height }));
```

For fixed mode, retain the existing `photosPerRow` behavior and equal 3:4 extents. For adaptive mode, calculate the content grid width from the selected column count, center a one-column single frame, and use two equal columns for multi-photo groups. Calculate each row height from its fixed placement, plus explicit row spacing, and store the resulting total in `heightTwips`.

- [ ] **Step 4: Implement the three-photo 2+1 row shape.**

Keep `layout.columns === 2` for a three-photo adaptive group. In `imageTable`, create the final row with one occupied cell spanning the two columns and center the photo. Do not shrink the occupied frame to fill the second cell.

- [ ] **Step 5: Make `imageTable` render the shared fixed extents.**

Use the layout’s `placements` exactly for every `ImageRun`. Keep `TableLayoutType.FIXED`, no borders, centered cell content, and `cantSplit: true` on each photo row. The image width and height must no longer depend on `photo.width`, `photo.height`, or page remainder in adaptive mode.

- [ ] **Step 6: Run the focused tests and make sizing GREEN.**

Run:

```powershell
pnpm exec vitest run src/features/reports/generateDocx.test.ts
```

Expected result: fixed-frame, mixed-orientation, 2+1, and 2x2 tests pass. Pagination tests may still fail until Task 3 is complete. If a sizing assertion fails, inspect the generated `wp:extent` and `w:gridCol` XML before changing constants.

- [ ] **Step 7: Commit the layout model.**

```powershell
git add -- app/src/features/reports/generateDocx.ts app/src/features/reports/generateDocx.test.ts
git commit -m "refactor: use fixed adaptive photo frames"
```

---

### Task 3: Make photo-backed inspection items atomic for pagination

**Files:**
- Modify: `C:\Users\xj\Desktop\7s管理\app\src\features\reports\generateDocx.ts`
- Test: `C:\Users\xj\Desktop\7s管理\app\src\features\reports\generateDocx.test.ts`

**Interfaces:**
- Consumes: group text, `PreparedPhoto[]`, `PhotoTableLayout`, paragraph height, and page estimator state.
- Produces: one outer item block for photo-backed groups, explicit page-break decisions, and unchanged plain paragraphs for no-photo groups.

- [ ] **Step 1: Add an item-block height calculation.**

Implement:

```ts
function photoGroupBlockHeightTwips(
  model: ReportModel,
  groupText: string,
  layout: PhotoTableLayout,
): number;
```

The return value must equal the text height, photo table height, and the fixed block spacing used by the DOCX children. It must not use `pagination.remainingPageTwips()` and must not apply a scale factor.

- [ ] **Step 2: Add an outer one-row block table.**

Implement:

```ts
function photoGroupBlock(
  model: ReportModel,
  groupText: string,
  photos: PreparedPhoto[],
  layout: PhotoTableLayout,
  pageBreakBefore: boolean,
): Table;
```

The table must have one borderless row marked `cantSplit: true`, one cell, and cell children in this order:

```ts
[
  bodyParagraph(model, groupText, {
    firstLineIndent: true,
    pageBreakBefore,
  }),
  imageTable(model, photos, layout),
]
```

For 1—4 photos, this makes the paragraph and all photo rows one Word table row. For more than 4 photos, the nested photo table may continue only between its own `cantSplit` rows. Do not emit a standalone group paragraph for a photo-backed group.

- [ ] **Step 3: Replace adaptive remainder fitting in `generateDocx`.**

Remove the branches that call `adaptivePhotoTableCanUseRemainingSpace()` or `fitPhotoTableToHeight()`. For every group, calculate the complete block height first:

```ts
const groupPageBreak = Boolean(
  preparedPhotos.length > 0 &&
  pagination.shouldBreakBefore(groupBlockHeight),
);
```

When `groupPageBreak` is true, start a new estimator page before consuming the item block. Do not reduce `layout.placements`.

- [ ] **Step 4: Keep text-only groups ordinary.**

For `preparedPhotos.length === 0`, continue to emit one `bodyParagraph` without `keepNext`, without a photo table, and without a forced break caused by a nonexistent photo block. This preserves the no-photo evaluation behavior.

- [ ] **Step 5: Bind section headings to the first complete item.**

Use the first photo-backed group’s complete block height when deciding whether a section heading should receive a page break. If the first group has no photos, keep the existing text-only section behavior. The section heading must not be left at the bottom without the first readable item.

- [ ] **Step 6: Add conservative renderer safety margin.**

Add one named constant, `photoBlockSafetyTwips`, equal to 6mm converted to twips. Include it in `photoGroupBlockHeightTwips()` and the estimator, but not inside the image frame. This protects against Word/LibreOffice paragraph and cell-margins differences without shrinking photos.

- [ ] **Step 7: Run focused tests and inspect XML.**

Run:

```powershell
pnpm exec vitest run src/features/reports/generateDocx.test.ts
```

Expected result: the full report-generation test file passes. Confirm the generated XML has no adaptive `fitPhotoTableToHeight` behavior, photo-backed group text occurs inside the outer block, and every photo relation remains present.

- [ ] **Step 8: Commit atomic pagination.**

```powershell
git add -- app/src/features/reports/generateDocx.ts app/src/features/reports/generateDocx.test.ts
git commit -m "fix: keep Word photo items together across pages"
```

---

### Task 4: Generate and visually verify representative DOCX pages

**Files:**
- Create: `C:\Users\xj\Desktop\7s管理\tmp\docs\word-photo-layout-rework.docx`
- Create: `C:\Users\xj\Desktop\7s管理\tmp\docs\word-photo-layout-rework.pdf`
- Create: `C:\Users\xj\Desktop\7s管理\tmp\docs\word-photo-layout-rework-*.png`
- Read: `C:\Users\xj\Desktop\7s管理\app\src\features\reports\generateDocx.ts`

**Interfaces:**
- Consumes: the completed `generateDocx` implementation and real portrait/landscape JPEG fixtures.
- Produces: page images and a written pass/fail record for single, double, triple, four-photo, and cross-page cases.

- [ ] **Step 1: Locate or create non-production JPEG fixtures without editing app data.**

Use existing local image fixtures if available. If the repository has no suitable fixtures, create temporary JPEG copies under `tmp/docs/` only; do not place them in `app/src`, do not add them to Git, and do not modify source photos.

- [ ] **Step 2: Generate one representative DOCX.**

Use the project runtime to produce a report containing, in order:

```text
single landscape photo
two photos with mixed orientation
three photos with mixed orientation
four photos with mixed orientation
an item positioned near a page boundary
```

Use the real `renderAnnotation` and `compressForDocx` path or valid test doubles that return valid JPEG bytes. Confirm the ZIP contains one media relationship for every input photo before rendering.

- [ ] **Step 3: Render with LibreOffice.**

Run:

```powershell
$out='C:\Users\xj\Desktop\7s管理\tmp\docs\lo-profile'
New-Item -ItemType Directory -Force -Path $out | Out-Null
& 'C:\Program Files\LibreOffice\program\soffice.exe' `
  "-env:UserInstallation=file:///$($out.Replace('\','/'))" `
  --headless --convert-to pdf `
  --outdir 'C:\Users\xj\Desktop\7s管理\tmp\docs' `
  'C:\Users\xj\Desktop\7s管理\tmp\docs\word-photo-layout-rework.docx'
```

Convert the PDF to PNG using the installed Poppler `pdftoppm`, or use the bundled DOCX renderer if Poppler is unavailable. Inspect every page at 100% with `view_image`.

- [ ] **Step 4: Check the visual acceptance list.**

Mark the run as passing only if:

- no item caption is separated from its own photos;
- a two-photo group has two equal frames;
- a three-photo group is a balanced 2+1 grid using the same frame size as the four-photo grid;
- a four-photo group has a complete 2x2 grid on one page when the block fits;
- a mixed portrait/landscape group has equal frames with no internal blank area;
- no single image is compressed merely because it is near the page bottom;
- any remaining blank area is caused by moving a complete block, not by a split table;
- all photos are present.

- [ ] **Step 5: Iterate only on named constants or measured block spacing.**

If the render is visually off, change only `adaptiveSingleFrameWidthMm`, `adaptiveSingleFrameHeightMm`, `adaptiveGridFrameWidthMm`, `adaptiveGridFrameHeightMm`, `photoBlockSpacingMm`, or `photoBlockSafetyTwips` one at a time. Re-run the focused tests and LibreOffice render after each change. Do not reintroduce source-ratio scaling or page-remainder compression.

- [ ] **Step 6: Clean temporary render files after evidence is recorded.**

Keep only the final inspection evidence required for review. Remove generated files under `tmp/docs/` with explicit file paths after visual inspection; never remove the project root or `.codex-preview/`.

---

### Task 5: Full verification and local APK build

**Files:**
- Modify: `C:\Users\xj\Desktop\7s管理\docs\superpowers\plans\2026-08-09-word-photo-layout-rework.md` to mark completed steps and record measured frame values.
- Modify: `C:\Users\xj\Desktop\7s管理\app\android\app\build.gradle` only after the DOCX render passes, if the user requests a new APK in this implementation turn.
- Create: `C:\Users\xj\Desktop\7s管理\output\7S-inspection-v<next-version>-word-layout.apk` only after the Android build passes.

**Interfaces:**
- Consumes: green focused tests, clean LibreOffice visual evidence, current Android version metadata, and JDK 21.
- Produces: full verification results and, if version bump is requested as part of this turn, an installable debug APK with SHA-256.

- [ ] **Step 1: Run the complete web test suite.**

```powershell
pnpm exec vitest run --maxWorkers=1
```

Expected: zero failed test files and zero failed tests.

- [ ] **Step 2: Run lint and web build.**

```powershell
pnpm run lint
pnpm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Run Android checks from the Android directory.**

Use JDK 21 and run:

```powershell
cd 'C:\Users\xj\Desktop\7s管理\app\android'
\.\gradlew.bat lintDebug assembleDebug
```

Expected: `lintDebug` and `assembleDebug` succeed. A generated Capacitor `ExampleUnitTest` class-not-found warning is recorded separately if it appears while `assembleDebug` succeeds.

- [ ] **Step 4: Build and hash the APK only after layout verification.**

Copy the successful debug APK to an ASCII filename under `output/`, then run:

```powershell
Get-FileHash 'C:\Users\xj\Desktop\7s管理\output\7S-inspection-v<next-version>-word-layout.apk' -Algorithm SHA256
```

Do not publish a GitHub Release or push a tag in this plan unless the user separately requests publication after reviewing the generated APK.

- [ ] **Step 5: Commit the verified implementation.**

```powershell
git add -- app/src/features/reports/generateDocx.ts app/src/features/reports/generateDocx.test.ts docs/superpowers/plans/2026-08-09-word-photo-layout-rework.md
git commit -m "fix: rework Word inspection photo layout"
```

---

## Plan Self-Review

- Spec coverage: fixed horizontal frames are covered by Task 2; atomic item pagination and no page-bottom scaling are covered by Task 3; mixed-orientation and 1—4 photo visual checks are covered by Task 4; original-photo protection and full verification are covered by Tasks 2, 4, and 5.
- Settings coverage: existing layout mode and row-limit settings remain present; adaptive mode caps columns at two, while fixed mode retains its current row-count behavior.
- Edge coverage: no-photo groups remain ordinary paragraphs; 5+ photos continue at complete row boundaries; missing photo relationships remain errors; `.codex-preview/` is never included.
- Placeholder scan: every implementation step contains concrete files, interfaces, commands, and expected outcomes.
- Type consistency: `PhotoTableLayout` remains the shared result of `photoTableLayout`; `photoGroupBlockHeightTwips` consumes that result; `photoGroupBlock` renders the same result; `PageLayoutEstimator` consumes the same calculated height.

## Execution Record (2026-08-09)

- [x] Adaptive three-photo groups use the same 78×58mm frames as four-photo groups, arranged as 2+1 with the final photo centered.
- [x] Added regression coverage for continuing with a following one-photo item when the three-photo block fits.
- [x] Focused report tests: 32/32 passed.
- [x] Full web tests: 50 files and 606 tests passed.
- [x] `pnpm run lint` and `pnpm run build` passed.
- [x] LibreOffice/PDF visual verification completed for 1, 2, 3, 4, and following-photo cases.
- [x] Android `lintDebug assembleDebug` passed with JDK 21; APK version is 1.1.5, versionCode 17.
