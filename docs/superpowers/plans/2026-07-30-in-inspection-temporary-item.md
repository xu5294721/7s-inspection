# 巡检过程中临时新增检查项 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前巡检草稿内追加一个只属于本次巡检的临时检查项，并让它完整参与拍照、评价、复核、备份恢复和 Word 生成流程。

**Architecture:** 用 `InspectionRepository.addTemporaryEntry` 在单个 IndexedDB 事务内读取巡检和条目、校验名称、计算末尾顺序、写入条目并把巡检状态恢复为 `draft`。页面只消费仓库返回的新条目和更新时间，不用内存中的整个巡检图覆盖数据库，从而避免与照片持久化并发时丢数据。

**Tech Stack:** React 19、TypeScript 6、Dexie 4、Vitest、Testing Library、Playwright、lucide-react。

## Global Constraints

- 临时项只写入当前巡检的 `entries` 与巡检记录，不写入 `checklistItems` 或 `routeTemplates`。
- 用户只填写“检查项名称”；名称使用 `normalizeRouteName()` 去除首尾空格，空名称和当前巡检同名均拒绝。
- 自动字段必须严格使用设计文档中的中文文案；`routeName`、`area`、`part` 均为规范化名称，`device` 和 `sevenSCategory` 为空，`team` 为“相关责任工班”，`quickPhrases` 为空数组。
- 条目和快照 ID 使用带临时项前缀的浏览器 UUID；`order` 为当前最大条目顺序加一。
- `entryId` 必须匹配 `temporary-entry-<UUID v4>`，`itemId` 必须匹配 `temporary-item-<UUID v4>`；条目主键已存在时使用 `add()` 拒绝覆盖。不同巡检可以复用普通固定项点 ID，因此只要求同一巡检内 `itemId` 唯一。
- 临时项快照 `routeOrder` 与新条目 `order` 相同；构造用的 `enabled` 为 `true`，`createdAt`、`updatedAt` 使用本次事务的 `updatedAt`，三者不会进入最终快照但必须满足 `ChecklistItem` 类型。
- 保存成功后清空搜索并显示在末尾；保存失败保留弹窗和输入；保存中禁止关闭和重复提交。
- 照片处理中或临时项保存中禁用新增按钮；巡检页面已切换时不得应用过期保存结果。
- 无照片临时项不进入 Word；有照片临时项按照片组实际分类进入对应章节。
- 不增加删除、排序、多字段编辑或整改追踪功能。
- 历史页“复制为新巡检”必须过滤临时项，避免把本次临时项带入以后巡检或生成无法备份的普通条目。
- 不修改三个原始 DOCX 文件；不执行 Git 操作。

---

### Task 1: 事务化追加临时条目

**Files:**
- Modify: `app/src/domain/inspection.ts`
- Modify: `app/src/db/inspectionRepository.ts`
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/db/backupRepository.ts`
- Modify: `app/src/lib/ids.ts`
- Test: `app/src/domain/inspection.test.ts`
- Test: `app/src/db/repositories.test.ts`
- Test: `app/src/db/backupRepository.test.ts`
- Test: `app/src/lib/ids.test.ts`

**Interfaces:**
- Produces: `createInspectionEntry(item: ChecklistItem, inspectionId: string, entryId: string, order: number): InspectionEntry`
- Produces: `TemporaryEntryAppendResult = { entry: InspectionEntry; updatedAt: string }`
- Produces: `InspectionRepository.addTemporaryEntry(inspectionId: string, name: string, entryId: string, itemId: string, updatedAt?: string): Promise<TemporaryEntryAppendResult>`
- Produces through dependency port: `addTemporaryEntry(...)` with the same signature.

- [ ] **Step 1: Write domain tests that define reusable snapshot creation**

Add tests asserting `createInspectionEntry()` copies a `ChecklistItem` into an immutable `ItemSnapshot`, clones `quickPhrases`, uses the supplied IDs/order, and that `createInspection()` still creates the same entries through this helper.

- [ ] **Step 2: Run the focused domain test and verify RED**

Run: `pnpm test:run src/domain/inspection.test.ts`

Expected: FAIL because `createInspectionEntry` is not exported.

- [ ] **Step 3: Implement the minimal domain helper**

Export `createInspectionEntry()` from `inspection.ts`; have `createInspection()` call it with ``${inspectionId}-entry-${item.id}`` and the array index. Keep snapshot creation private and clone `quickPhrases`.

- [ ] **Step 4: Run the focused domain test and verify GREEN**

Run: `pnpm test:run src/domain/inspection.test.ts`

Expected: PASS.

- [ ] **Step 5: Write repository tests for the dedicated transaction**

Add focused tests that seed a graph and call:

```ts
await repository.addTemporaryEntry(
  "inspection-1",
  "  临时配电间  ",
  "temporary-entry-entry-uuid",
  "temporary-item-item-uuid",
  "2026-07-30T10:00:00.000Z",
);
```

Assert the returned/stored entry has `order = max(existing order) + 1`, the exact generated snapshot fields, empty `groupIds`, status `draft`, and the supplied `updatedAt`. Also assert pre-existing entries, groups, photos, `checklistItems`, and `routeTemplates` are byte-for-byte/deep-equal unchanged.

Add separate tests for: empty normalized name; duplicate normalized route name with no partial write; unknown inspection; soft-deleted inspection; malformed/prefix-only/non-v4 IDs; duplicate entry ID; duplicate `itemId` in the same inspection; and a forced inspection-update failure rolling back the newly inserted entry. The duplicate-name error text is `当前巡检中已存在同名检查项` and missing/deleted text is `巡检记录不存在或已删除。`.

Add repository concurrency tests: two different names submitted concurrently get distinct consecutive `order` values; two concurrent normalized-equal names produce exactly one success; a temporary-entry append concurrent with `addPhotoToGoodGroup` preserves both writes; two photos concurrently appended to the same entry are both retained; and a new photo-group ID already owned by another inspection causes the entire photo append to roll back.

- [ ] **Step 6: Run repository tests and verify RED**

Run: `pnpm test:run src/db/repositories.test.ts`

Expected: FAIL because `addTemporaryEntry` does not exist.

- [ ] **Step 7: Implement the dedicated transaction and dependency port**

Inside one Dexie `rw` transaction over `inspections` and `entries`:

```ts
const inspection = await db.inspections.get(inspectionId);
if (!inspection || inspection.deletedAt !== null) throw new GraphIntegrityError("巡检记录不存在或已删除。");
const normalizedName = normalizeRouteName(name);
if (!normalizedName) throw new GraphIntegrityError("检查项名称不能为空。");
const entries = await db.entries.where("inspectionId").equals(inspectionId).toArray();
if (entries.some((entry) => normalizeRouteName(entry.itemSnapshot.routeName) === normalizedName)) {
  throw new GraphIntegrityError("当前巡检中已存在同名检查项");
}
```

Add `isPrefixedBrowserUuid(value, prefix)` in `app/src/lib/ids.ts` and validate complete UUID v4 suffixes plus same-inspection `itemId` uniqueness. Create a `ChecklistItem` with the exact design defaults, call `createInspectionEntry`, insert only that entry with `add()`, then update only the inspection row to `{ status: "draft", updatedAt }`. Export the result type and wire the method through `InspectionRepositoryPort` and `createAppDependencies`. In `addPhotoToGoodGroup`, use `photoGroups.add()` for a newly created group so an ID conflict cannot overwrite another inspection.

- [ ] **Step 8: Run domain and repository tests and verify GREEN**

Run: `pnpm test:run src/domain/inspection.test.ts src/db/repositories.test.ts`

Expected: PASS.

- [ ] **Step 9: Write backup round-trip and malformed temporary-entry tests**

Create a source database with a normal item/template plus a temporary entry whose `itemId` is absent from `checklistItems`. Assert `createBackup`, `inspectBackup`, and both `restoreBackup(..., "replace")` and `restoreBackup(..., "merge")` preserve the exact temporary `InspectionEntry` without creating a checklist item. Add negative tests proving a non-temporary missing item reference, prefix-only/non-v4 temporary IDs, a temporary entry whose snapshot ID differs from `itemId`, duplicate `itemId` values in one inspection, and duplicate normalized route names in one inspection are rejected.

- [ ] **Step 10: Run backup tests and verify RED**

Run: `pnpm test:run src/db/backupRepository.test.ts`

Expected: FAIL because `assertInspectionGraphs` currently requires every entry item ID to exist in `checklistItems`.

- [ ] **Step 11: Permit only self-contained temporary snapshots during backup validation**

In `assertInspectionGraphs`, always require `entry.itemSnapshot.id === entry.itemId`. Require item-library membership unless `isPrefixedBrowserUuid` validates both temporary IDs. Group entries by inspection and reject duplicate `itemId` or normalized `itemSnapshot.routeName`. Do not synthesize an item row during restore and do not relax route-template validation.

- [ ] **Step 12: Run backup tests and verify GREEN**

Run: `pnpm test:run src/db/backupRepository.test.ts`

Expected: PASS.

### Task 2: 巡检页新增入口和单字段弹窗

**Files:**
- Modify: `app/src/features/inspections/CustomRouteDialog.tsx`
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Modify: `app/src/features/history/HistoryPage.tsx`
- Modify: `app/src/styles/global.css`
- Test: `app/src/features/inspections/inspection-flow.test.tsx`
- Test: `app/src/features/history/history.test.tsx`

**Interfaces:**
- Consumes: `inspectionRepository.addTemporaryEntry(...) -> TemporaryEntryAppendResult`
- Produces: generalized dialog props `title`, `fieldLabel`, `saveLabel?`, existing `openerRef`, `onCancel`, and `onSave`.

- [ ] **Step 1: Write UI tests for opening and successful save**

Add tests that render an existing draft, click the `新增检查项` button, see a dialog titled `新增本次检查项` with only one textbox named `检查项名称`, enter `临时配电间`, save, and assert the route/entry appears after the pre-existing entries. Start with a search that hides all entries and assert successful save clears the searchbox and reveals the new item.

- [ ] **Step 2: Write UI tests for error and concurrency behavior**

Inject an `inspectionRepository` whose `addTemporaryEntry` rejects and assert the dialog, typed value, and error remain. Use a deferred promise to double-click save and assert only one repository call occurs; while pending assert cancel, input, save, and opener are disabled. Add a reload test using the real test database to prove persistence.

Assert a failed save returns focus to the dialog input. Add a history-copy test proving temporary entries are omitted from the copied inspection and a complete backup can still be created afterward.

- [ ] **Step 3: Run the UI test and verify RED**

Run: `pnpm test:run src/features/inspections/inspection-flow.test.tsx`

Expected: FAIL because the button/dialog flow does not exist.

- [ ] **Step 4: Generalize the existing dialog without changing route-template behavior**

Add `title = "增加自定义检查项目"` and `fieldLabel = "检查项目名称"` defaults. Render IDs/labels from props so route-template callers retain current text while `InspectionPage` can request `新增本次检查项` and `检查项名称`. Preserve focus trapping, escape handling, disabled-close behavior, error retention, and duplicate-submit guard.

- [ ] **Step 5: Implement the inspection-page flow**

Import `Plus` and `CustomRouteDialog`. Add dialog and save state plus an opener ref. Generate IDs as:

```ts
const entryId = `temporary-entry-${createBrowserUuid()}`;
const itemId = `temporary-item-${createBrowserUuid()}`;
```

Capture the current inspection ID/generation before awaiting. On success, functionally append the returned entry only when the current graph still belongs to that inspection and does not already contain the entry; set `status: "draft"` and `updatedAt` from the result, clear the query, and close the dialog. Keep the dialog open when the repository throws. Disable the opener while `processing`, saving, or the dialog is open.

- [ ] **Step 6: Add responsive toolbar styles**

Wrap search and button in `.inspection-search-toolbar`: desktop uses `grid-template-columns: minmax(0, 1fr) auto`; at `max-width: 420px` stack to one column and make the button full width. Keep 44px minimum tap targets and ensure labels wrap instead of overflowing.

- [ ] **Step 7: Run the UI test and verify GREEN**

Run: `pnpm test:run src/features/inspections/inspection-flow.test.tsx`

Expected: PASS.

### Task 3: Word 投影回归与移动端流程

**Files:**
- Test: `app/src/features/reports/reportModel.test.ts`
- Test: `app/tests/e2e/inspection-flow.spec.ts`

**Interfaces:**
- Consumes: temporary `InspectionEntry` snapshot and the existing `buildReportModel` behavior.

- [ ] **Step 1: Add report-model regression tests**

Build one graph containing a regular photographed entry, an unphotographed temporary entry, and a photographed temporary entry in each category. Assert the unphotographed temporary route is absent from all sections/annex rows. Assert section text and annex route name, area/device, part, category, count, and team for both ordinary and temporary rows.

- [ ] **Step 2: Run report tests and confirm current behavior**

Run: `pnpm test:run src/features/reports/reportModel.test.ts`

Expected: PASS without production report changes. A failure blocks this task and must be diagnosed before any change to `app/src/features/reports/reportModel.ts`; report production changes are outside the planned write set unless the design is amended.

- [ ] **Step 3: Add mobile Playwright coverage**

Parameterize viewports `{ width: 360, height: 800 }` and `{ width: 412, height: 915 }`. For each viewport: create/start a draft, click `新增检查项`, save `临时配电间`, assert no horizontal overflow, attach the existing fixture photo through `从相册选择`, verify the photo count, click `完成检查，进入复核`, and assert the temporary item’s photo is represented in the good category. Confirm the dialog and toolbar rectangles stay within the viewport.

- [ ] **Step 4: Run the focused E2E test**

Run: `pnpm exec playwright test tests/e2e/inspection-flow.spec.ts`

Expected: PASS in installed Chrome.

### Task 4: 完整验证与交付

**Files:**
- Verify only: all modified files and original DOCX hashes.

- [ ] **Step 1: Run focused tests twice**

Run twice: `pnpm test:run src/domain/inspection.test.ts src/db/repositories.test.ts src/db/backupRepository.test.ts src/features/inspections/inspection-flow.test.tsx src/features/reports/reportModel.test.ts`

Expected: both runs PASS with zero failures.

- [ ] **Step 2: Run the full unit, stress, and extraction suites**

Run: `pnpm test:run`

Run: `pnpm test:stress`

Run: `pnpm test:extract-default-items`

Expected: all commands exit 0.

- [ ] **Step 3: Run static and production checks**

Run: `pnpm lint`

Run: `pnpm build`

Expected: both commands exit 0 with no lint/type/build errors.

- [ ] **Step 4: Run full browser regression**

Run: `pnpm test:e2e`

Expected: all Playwright tests pass.

- [ ] **Step 5: Verify original files are unchanged**

Compare SHA-256 for `C:/Users/xj/Desktop/7s管理/向塘钢轨焊接整修7S管理考核办法.docx`, `C:/Users/xj/Desktop/7s管理/向塘钢轨焊接整修车间7月21日7S巡检通报.docx`, and `C:/Users/xj/Desktop/7s管理/向塘钢轨焊接整修车间7月23日7S巡检通报.docx` against `14047FF931183E967F58B0B8E93A06DFCA8CF4D0D5B01FB52D9B965E018C252E`, `9B2B8EF4027AEDA626C10A48C4B2850B46304BE73181573A0879005ED15BF144`, and `22939F5A7FB34B474BD200A0ACD45B6F58149EF35DD5F0826DC420E642C340DA`. Expected: all three hashes match.

- [ ] **Step 6: Restart preview and smoke-test the current build**

Start `pnpm exec vite preview --host 0.0.0.0` on an available port, open the localhost URL, add a temporary inspection item, refresh, and confirm it remains available for photo capture with no horizontal overflow.
