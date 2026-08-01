# 通报照片排版设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在通报复核和 Word 模板设置中支持“自适应/固定”两种照片排版模式，并允许每行 1～4 张照片。

**Architecture:** 把排版模式和每行上限/列数作为模板及巡检记录的独立设置保存。巡检记录中的设置继续使用 nullable override，未覆盖时继承模板。Word 生成时按照片组独立计算列数：固定模式使用设置列数，自适应模式使用 `min(照片数, 上限)`，不跨项点合并照片。

**Tech Stack:** React + TypeScript, Zod, Dexie/IndexedDB, Vitest, `docx`。

## Global Constraints

- 保留已存在的 1.0.2 未提交修改，不重置或覆盖无关文件。
- 不执行 `git commit`、`git push`、tag 或 GitHub Release；用户此前明确暂不上载。
- 原版 1.0.1 不变；旧模板没有排版模式字段时按固定模式兼容读取。
- 所有新增行为先写失败测试，再写生产代码。

---

### Task 1: 排版领域类型、校验与旧数据兼容

**Files:**
- Create: `app/src/domain/photoLayout.ts`
- Create: `app/src/domain/photoLayout.test.ts`
- Modify: `app/src/domain/models.ts`
- Modify: `app/src/domain/schemas.ts`
- Modify: `app/src/domain/inspection.ts`
- Modify: `app/src/db/inspectionRepository.ts`
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/test/fixtures.ts`

**Interfaces:**
- `PhotoLayoutMode = "adaptive" | "fixed"`。
- `PhotosPerRow = 1 | 2 | 3 | 4`。
- `columnsForPhotoCount(mode, photosPerRow, photoCount): PhotosPerRow` 返回单个照片组在 Word 中实际使用的列数。
- `Inspection` 增加 `photoLayoutModeOverride: PhotoLayoutMode | null`；`ReportTemplate` 增加 `photoLayoutMode: PhotoLayoutMode`，并把 `photosPerRow` 扩为 `PhotosPerRow`。

- [ ] **Step 1: Write the failing tests**

```ts
test.each([
  ["adaptive", 4, 1, 1],
  ["adaptive", 4, 2, 2],
  ["adaptive", 4, 4, 4],
  ["adaptive", 4, 5, 4],
  ["fixed", 2, 1, 2],
  ["fixed", 2, 5, 2],
])("calculates %s layout columns", (mode, limit, count, expected) => {
  expect(columnsForPhotoCount(mode as PhotoLayoutMode, limit as PhotosPerRow, count)).toBe(expected);
});

test("accepts 1 to 4 rows and defaults missing persisted mode to fixed", () => {
  expect(reportTemplateSchema.parse({ ...makeTemplate(), photosPerRow: 1 }).photosPerRow).toBe(1);
  expect(reportTemplateSchema.parse({ ...makeTemplate(), photoLayoutMode: undefined }).photoLayoutMode).toBe("fixed");
  expect(inspectionRecordSchema.parse({ ...makeInspection(), photoLayoutModeOverride: undefined }).photoLayoutModeOverride).toBeNull();
});
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run: `pnpm exec vitest run app/src/domain/photoLayout.test.ts --maxWorkers=1`

Expected: FAIL because the new types/helper and schema fields do not exist yet.

- [ ] **Step 3: Implement the minimal domain and persistence changes**

Use the shared types in models and schemas. Make `reportTemplateSchema.photoLayoutMode` default to `"fixed"`, make `inspectionRecordSchema.photoLayoutModeOverride` nullable with a default of `null`, expand valid row values to 1/2/3/4, and normalize missing mode fields in `readGraphFromDb` to `null` for inspections. Update `createInspection`, both seeded templates, and fixtures to explicitly use fixed mode.

- [ ] **Step 4: Run the focused tests and affected repository tests**

Run: `pnpm exec vitest run app/src/domain/photoLayout.test.ts app/src/db/repositories.test.ts app/src/app/dependencies.test.ts --maxWorkers=1`

Expected: PASS with no failures.

### Task 2: 复核页、模板设置和保存接口

**Files:**
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/db/inspectionRepository.ts`
- Modify: `app/src/features/review/ReviewPage.tsx`
- Modify: `app/src/features/review/ReviewPage.test.tsx`
- Modify: `app/src/features/settings/TemplateSettingsPage.tsx`
- Modify: `app/src/features/settings/template-settings.test.tsx`

**Interfaces:**
- `updateReviewSettings(id, templateId, templateVersion, photoLayoutModeOverride, photosPerRowOverride)` 同时保存模式和 1～4 张设置。
- 复核页显示两个选择框：`照片排版模式`（自适应/固定）和 `每行照片数`（1张/2张/3张/4张）。
- 模板设置使用同样的两个选择框。

- [ ] **Step 1: Write failing UI and repository tests**

新增断言覆盖：复核页显示两个选择框及完整选项；选择自适应和 4 张后保存两个值；模板设置保存自适应和 1 张；旧模板仍显示固定模式。更新旧的 2/3 选项断言为 1/2/3/4。

- [ ] **Step 2: Run the focused tests and verify they fail for the missing behavior**

Run: `pnpm exec vitest run app/src/features/review/ReviewPage.test.tsx app/src/features/settings/template-settings.test.tsx --maxWorkers=1`

Expected: FAIL on missing mode control, missing 1/4 options, or the old persistence signature.

- [ ] **Step 3: Implement the minimal UI and persistence changes**

Use the inspection override when present, otherwise the template mode/row setting. When either control changes, persist both effective values as overrides so generating the current inspection is deterministic. Update template version save propagation to pass both override fields and retain them. Validation errors must say `每行照片数只能为1到4张。`.

- [ ] **Step 4: Run the focused UI and repository tests**

Run: `pnpm exec vitest run app/src/features/review/ReviewPage.test.tsx app/src/features/settings/template-settings.test.tsx app/src/db/repositories.test.ts --maxWorkers=1`

Expected: PASS with all existing save-queue and template-version behaviors retained.

### Task 3: Report model and Word photo tables

**Files:**
- Modify: `app/src/features/reports/reportModel.ts`
- Modify: `app/src/features/reports/generateDocx.ts`
- Modify: `app/src/features/reports/reportModel.test.ts`
- Modify: `app/src/features/reports/generateDocx.test.ts`

**Interfaces:**
- `ReportModel` carries `photoLayoutMode` and `photosPerRow` (where `photosPerRow` is the adaptive maximum or fixed column count).
- `imageTable` computes `const columns = columnsForPhotoCount(model.photoLayoutMode, model.photosPerRow, photos.length)` for each group before creating grid columns and rows.

- [ ] **Step 1: Write failing report tests**

Add a model test that propagates adaptive mode and a DOCX XML test that creates separate groups with 1 and 5 photos under adaptive limit 4, then asserts the image tables use 1 column and 4 columns respectively. Add a fixed-mode test asserting a 1-photo group still emits the selected fixed number of columns.

- [ ] **Step 2: Run the report tests and verify the failure**

Run: `pnpm exec vitest run app/src/features/reports/reportModel.test.ts app/src/features/reports/generateDocx.test.ts --maxWorkers=1`

Expected: FAIL because the report model does not expose mode and the generated table currently always uses one global fixed column count.

- [ ] **Step 3: Implement model propagation and per-group table sizing**

Pass the inspection override mode/row or template mode/row through `buildReportModel`. In `imageTable`, use the helper to size the current group only; preserve cell widths, image aspect-ratio limits, empty fixed cells, and photo order.

- [ ] **Step 4: Run report tests and then the full suite**

Run: `pnpm exec vitest run app/src/features/reports/reportModel.test.ts app/src/features/reports/generateDocx.test.ts --maxWorkers=1`, then `pnpm exec vitest run --maxWorkers=1`.

Expected: all report tests and the full Vitest suite pass.

### Task 4: Static/build verification

**Files:**
- No additional source files; inspect the complete diff for unintended changes.

- [ ] **Step 1: Run lint and production build**

Run: `pnpm lint` and `pnpm build` from `C:\Users\xj\Desktop\7s管理\app`.

Expected: both commands exit with code 0.

- [ ] **Step 2: Run the existing stress test**

Run: `pnpm test:stress` from `C:\Users\xj\Desktop\7s管理\app`.

Expected: the stress test exits with code 0.

- [ ] **Step 3: Verify version/release constraints and worktree state**

Run: `git diff --check`, `git status --short`, and inspect that no commit, tag, push, or GitHub Release was created. Report the exact test/build results and leave the pre-existing 1.0.2 files untouched except for required integration points.
