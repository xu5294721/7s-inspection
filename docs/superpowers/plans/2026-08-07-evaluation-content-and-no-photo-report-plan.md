# 无照片评价项点与检查内容模板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 让无照片但有评价内容的检查项点可靠进入复核和 Word，并提供全局默认、项点覆盖的大项/小项检查内容模板。

**Architecture:** 将检查内容保存与空评价组创建收敛到 `InspectionRepository` 的单事务；复核页显示所有评价组；新增独立的检查内容模板表和项点 assignment 表，选择结果保存大项名称快照，避免模板后续修改影响历史记录。

**Tech Stack:** React 19、TypeScript、Dexie/IndexedDB、Zod、Vitest、Testing Library、Playwright、Capacitor Android。

## Global Constraints

- 单用户、离线优先、本地 IndexedDB；不增加账号、后端、云同步或协作功能。
- 旧备份 schema、旧三分类模板、旧 `environment/placement/equipment/safety` 选择值必须继续读取。
- 原图不修改；Word 继续使用现有 DOCX 图片处理链路。
- 所有生产改动先有失败测试；每个任务完成后运行对应测试。
- 最终运行受影响测试、`pnpm exec vitest run --maxWorkers=1`、`pnpm lint`、`pnpm build`，涉及 Android 时运行 Capacitor copy、`lintDebug` 和 `assembleDebug`。

---

### Task 1: 固化无照片评价项点的失败测试

**Files:**
- Modify: `app/src/db/repositories.test.ts`
- Modify: `app/src/features/inspections/InspectionEntryEditor.test.tsx`
- Modify: `app/src/features/review/ReviewPage.test.tsx`
- Modify: `app/src/features/reports/reportModel.test.ts`

**Interfaces:**
- Consumes: 当前 `InspectionRepository.updateEntryCheckSelections`、`InspectionEntryEditor`、`ReviewPage` 和 `buildReportModel`。
- Produces: 明确证明“选择评价内容后必须有空 good group、复核可见、Word 有正文”的回归测试。

- [ ] **Step 1: 写 repository 失败测试**

在 `repositories.test.ts` 增加一个只含一个 entry、无 group、无照片的测试，调用 `updateEntryCheckSelections("inspection-1", entry.id, [{ category: "environment", value: "干净整洁", isCustom: false }])`，断言 entry 的 `checkSelections` 保存、`groupIds` 出现一个 ID、对应 group 为 `category: "good"` 且 `photoIds: []`。

- [ ] **Step 2: 运行测试确认失败**

运行：

```bash
cd C:\Users\xj\Desktop\7s管理\app
pnpm exec vitest run src/db/repositories.test.ts --maxWorkers=1
```

预期：新增断言失败，因为当前 update 方法只保存 selections，不创建 group。

- [ ] **Step 3: 写复核失败测试**

构造包含一个 `photoIds: []` group 的 graph，渲染 `ReviewPage`，断言该 group 的项点文本和“0 张照片”可见；调用分类排序后断言空照片组 ID 也进入排序参数。

- [ ] **Step 4: 运行复核测试确认失败**

运行：

```bash
pnpm exec vitest run src/features/review/ReviewPage.test.tsx --maxWorkers=1
```

预期：新增可见性或排序断言失败，因为当前 `visibleGroups` 和 `reorderCategory` 都过滤了 `photoIds.length === 0`。

- [ ] **Step 5: 写真实 Word 链路失败测试**

在现有报告测试中同时构造 `entry.checkSelections`、空 good group 和空 photos，断言生成的 document XML 同时包含路线名和“环境卫生干净整洁”。另加一个页面流程断言，确认选择内容后完成项点的 `data-complete` 为 `true`。

- [ ] **Step 6: 运行新增测试确认失败并提交测试**

运行受影响测试，确认失败原因分别指向空组缺失和复核过滤；提交测试：

```bash
git add app/src/db/repositories.test.ts app/src/features/inspections/InspectionEntryEditor.test.tsx app/src/features/review/ReviewPage.test.tsx app/src/features/reports/reportModel.test.ts
git commit -m "test: cover photo-free evaluation report flow"
```

### Task 2: 原子保存检查内容并修复复核过滤

**Files:**
- Modify: `app/src/db/inspectionRepository.ts`
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/features/inspections/InspectionEntryEditor.tsx`
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Modify: `app/src/features/review/ReviewPage.tsx`
- Modify: `app/src/features/review/reviewSummary.ts`
- Modify: `app/src/features/review/ReviewGroupList.tsx`

**Interfaces:**
- Consumes: Task 1 failing tests and existing `normalizeInspectionCheckSelections`.
- Produces: `updateEntryCheckSelections` as the sole atomic entry-selection/evaluation-group operation; all valid groups visible and sortable.

- [ ] **Step 1: Implement the repository transaction**

Update `InspectionRepository.updateEntryCheckSelections` to run a transaction over `inspections`, `entries`, `photoGroups` and `templates`. It must normalize selections, load the entry, create one good empty group when selections become non-empty and `entry.groupIds` is empty, and remove only an unedited empty auto group when selections become empty. Return the updated entry and timestamp.

- [ ] **Step 2: Remove the UI race**

Change `InspectionEntryEditor.saveCheckSelections` to await only `onSaveCheckSelections`; remove the follow-up `onCreatePhotoGroup("good")` call. Keep manual category selection through `EmptyEvaluationPicker` unchanged.

- [ ] **Step 3: Include empty groups in review**

Change `ReviewPage.visibleGroups`, category sort input, and error focus lookup to use all valid `graph.groups`. Keep photo counters based on `photoIds.length`; do not invent placeholder photos. Update accessible text in `ReviewGroupList` so a zero-photo card is labeled as text-only evaluation.

- [ ] **Step 4: Run the red tests and make them green**

```bash
pnpm exec vitest run src/db/repositories.test.ts src/features/inspections/InspectionEntryEditor.test.tsx src/features/review/ReviewPage.test.tsx src/features/reports/reportModel.test.ts --maxWorkers=1
```

Expected: all Task 1 tests pass and no existing test regresses.

- [ ] **Step 5: Commit the bug fix**

```bash
git add app/src/db/inspectionRepository.ts app/src/app/dependencies.ts app/src/features/inspections/InspectionEntryEditor.tsx app/src/features/inspections/InspectionPage.tsx app/src/features/review/ReviewPage.tsx app/src/features/review/reviewSummary.ts app/src/features/review/ReviewGroupList.tsx
git commit -m "fix: preserve photo-free evaluation entries in review and Word"
```

### Task 3: Add template domain model, schema, and migration fixtures

**Files:**
- Modify: `app/src/domain/models.ts`
- Modify: `app/src/domain/schemas.ts`
- Modify: `app/src/db/database.ts`
- Create: `app/src/domain/inspectionCheckTemplates.ts`
- Create: `app/src/domain/inspectionCheckTemplates.test.ts`
- Create: `app/src/db/inspectionCheckTemplateRepository.ts`
- Create: `app/src/db/inspectionCheckTemplateRepository.test.ts`

**Interfaces:**
- Consumes: fixed built-in definitions in `app/src/domain/inspectionCheckContents.ts` and current Dexie version 2.
- Produces: `InspectionCheckTemplate`, category/option types, assignment records, `effectiveInspectionCheckTemplate`, and a repository that seeds one global default template.

- [ ] **Step 1: Write schema and resolution failures**

Add tests for:

```ts
effectiveInspectionCheckTemplate(globalTemplate, undefined) === globalTemplate;
effectiveInspectionCheckTemplate(globalTemplate, itemOverride) === itemOverride;
validateTemplate(defaultOptionId) rejects an ID not present in enabled options;
```

Add a compatibility test that old selections with `category: "environment"` remain valid.

- [ ] **Step 2: Run the tests and confirm missing types/functions fail**

```bash
pnpm exec vitest run src/domain/inspectionCheckTemplates.test.ts src/db/inspectionCheckTemplateRepository.test.ts --maxWorkers=1
```

- [ ] **Step 3: Add stable template types and Zod schemas**

Define template/category/option/assignment interfaces. Keep selection `category` as a string ID, add optional `categoryLabel`, and allow legacy IDs. Define schemas for enabled flags, ordering, unique IDs, valid default option references, global versus item scope, and assignment ownership.

- [ ] **Step 4: Add Dexie tables and repository**

Create version 3 stores for `inspectionCheckTemplates` and `inspectionCheckTemplateAssignments`. Add repository methods `list()`, `get(id)`, `getDefault()`, `save(template)`, `assignToItem(itemId, templateId)`, `removeAssignment(itemId)`, and `getEffectiveForItem(itemId)`. Seed the built-in global template from the existing three active definitions and retain legacy `safety` as a compatibility-only definition.

- [ ] **Step 5: Verify Task 3**

```bash
pnpm exec vitest run src/domain/inspectionCheckTemplates.test.ts src/db/inspectionCheckTemplateRepository.test.ts --maxWorkers=1
```

- [ ] **Step 6: Commit the data layer**

```bash
git add app/src/domain/models.ts app/src/domain/schemas.ts app/src/domain/inspectionCheckTemplates.ts app/src/domain/inspectionCheckTemplates.test.ts app/src/db/database.ts app/src/db/inspectionCheckTemplateRepository.ts app/src/db/inspectionCheckTemplateRepository.test.ts
git commit -m "feat: add configurable inspection check templates"
```

### Task 4: Add backup and historical-selection compatibility

**Files:**
- Modify: `app/src/db/backupRepository.ts`
- Modify: `app/src/db/backupRepository.test.ts`
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/domain/inspectionCheckContents.ts`

**Interfaces:**
- Consumes: Task 3 template tables and `categoryLabel` selection snapshot.
- Produces: schema 4 backup payload that round-trips templates and assignments while schema 1–3 backups restore with the built-in global template.

- [ ] **Step 1: Write round-trip and old-backup failure tests**

Add a backup test with global and item override templates, assignment, and a selection carrying `categoryLabel`. Assert export/import preserves all rows. Add an old schema fixture with no template tables and assert restore seeds the built-in template without altering the old entry text.

- [ ] **Step 2: Run tests and observe failures**

```bash
pnpm exec vitest run src/db/backupRepository.test.ts --maxWorkers=1
```

- [ ] **Step 3: Extend backup payload and restore**

Add template and assignment JSON paths to the new schema while retaining existing paths. Include them in both `createBackup` and `streamBackup`, validate counts and hashes, and restore them transactionally. Old schema restores must call the template repository seeding path before report data is read.

- [ ] **Step 4: Snapshot labels in normalization/report formatting**

Update `normalizeInspectionCheckSelections` and description formatting to accept effective definitions for new selections, but use `categoryLabel` first and legacy built-in labels as fallback. Never re-label an old selection from the current template.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec vitest run src/db/backupRepository.test.ts src/domain/inspectionCheckContents.test.ts --maxWorkers=1
git add app/src/db/backupRepository.ts app/src/db/backupRepository.test.ts app/src/app/dependencies.ts app/src/domain/inspectionCheckContents.ts
git commit -m "feat: back up inspection check template snapshots"
```

### Task 5: Integrate effective templates into the inspection selector

**Files:**
- Modify: `app/src/features/inspections/InspectionCheckContentEditor.tsx`
- Modify: `app/src/features/inspections/InspectionEntryEditor.tsx`
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Modify: `app/src/features/review/ReviewPage.tsx`
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/features/inspections/inspection-check-content-editor.test.tsx`
- Modify: `app/src/features/inspections/InspectionEntryEditor.test.tsx`

**Interfaces:**
- Consumes: `getEffectiveForItem` from Task 3 and snapshot-aware selection formatting from Task 4.
- Produces: selector UI that preselects enabled default options for new entries, allows one option per category, supports custom text, and preserves saved labels.

- [ ] **Step 1: Add failing selector tests**

Test that a new entry shows default options selected without writing until confirmation; selecting a different option replaces the category selection; a disabled default is not selected; a saved custom selection remains visible even when its template option is later disabled.

- [ ] **Step 2: Run selector tests and confirm failure**

```bash
pnpm exec vitest run src/features/inspections/inspection-check-content-editor.test.tsx src/features/inspections/InspectionEntryEditor.test.tsx --maxWorkers=1
```

- [ ] **Step 3: Implement effective-template props and defaults**

Pass the effective template into the editor. Build draft selections from entry snapshots; only when the entry has no selections add enabled category defaults to the draft. On confirmation, write `category`, `categoryLabel`, `value`, and `isCustom` for each selected category.

- [ ] **Step 4: Verify the full selector flow**

```bash
pnpm exec vitest run src/features/inspections/inspection-check-content-editor.test.tsx src/features/inspections/InspectionEntryEditor.test.tsx src/features/inspections/inspection-flow.test.tsx --maxWorkers=1
```

- [ ] **Step 5: Commit selector integration**

```bash
git add app/src/features/inspections/InspectionCheckContentEditor.tsx app/src/features/inspections/InspectionEntryEditor.tsx app/src/features/inspections/InspectionPage.tsx app/src/features/review/ReviewPage.tsx app/src/app/dependencies.ts app/src/features/inspections/inspection-check-content-editor.test.tsx app/src/features/inspections/InspectionEntryEditor.test.tsx
git commit -m "feat: use effective check templates in inspection selection"
```

### Task 6: Build global and item override template management UI

**Files:**
- Create: `app/src/features/settings/InspectionCheckTemplatePage.tsx`
- Create: `app/src/features/settings/InspectionCheckTemplatePage.test.tsx`
- Create: `app/src/features/settings/InspectionCheckTemplateEditor.tsx`
- Create: `app/src/features/settings/InspectionCheckTemplateEditor.test.tsx`
- Modify: `app/src/app/router.tsx`
- Modify: `app/src/features/settings/SettingsPage.tsx`
- Modify: `app/src/app/dependencies.ts`

**Interfaces:**
- Consumes: Task 3 repository methods and Task 5 effective-template selector.
- Produces: settings entry for global template CRUD and item assignment/override without changing Excel item identity fields.

- [ ] **Step 1: Write failing UI tests**

Test adding a major category, adding a minor option, choosing its default, rejecting an invalid empty template, saving a global template, assigning an item override, and removing the override to restore global behavior.

- [ ] **Step 2: Run tests to confirm failure**

```bash
pnpm exec vitest run src/features/settings/InspectionCheckTemplatePage.test.tsx src/features/settings/InspectionCheckTemplateEditor.test.tsx --maxWorkers=1
```

- [ ] **Step 3: Implement editor validation and persistence**

Use immutable local draft state for categories/options, validate non-empty enabled category and option labels, validate one valid default option per category, save through the repository, and show an error without mutating persisted data when validation fails.

- [ ] **Step 4: Add routing and item assignment**

Add a settings route and link. Provide a checklist-item picker for creating or assigning an item-scoped template; use the assignment repository instead of adding template fields to Excel import rows.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec vitest run src/features/settings/InspectionCheckTemplatePage.test.tsx src/features/settings/InspectionCheckTemplateEditor.test.tsx src/app/dependencies.test.ts --maxWorkers=1
git add app/src/features/settings/InspectionCheckTemplatePage.tsx app/src/features/settings/InspectionCheckTemplatePage.test.tsx app/src/features/settings/InspectionCheckTemplateEditor.tsx app/src/features/settings/InspectionCheckTemplateEditor.test.tsx app/src/app/router.tsx app/src/features/settings/SettingsPage.tsx app/src/app/dependencies.ts
git commit -m "feat: manage global and item inspection check templates"
```

### Task 7: Add end-to-end regression coverage and polish review behavior

**Files:**
- Modify: `app/tests/e2e/inspection-flow.spec.ts`
- Modify: `app/tests/e2e/word-export.spec.ts`
- Modify: `app/tests/e2e/offline-resume.spec.ts`
- Modify: `app/src/features/review/ReviewPage.test.tsx`
- Modify: `app/src/features/reports/reportModel.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5 and 6.
- Produces: browser-level proof for the exact user workflow and no regression in offline resume or Word export.

- [ ] **Step 1: Add Playwright scenario**

Create a test that selects default “环境卫生—干净整洁” with no image, confirms the item, enters review, observes the text-only card and 0-photo count, reorders it, exports Word, and checks the downloaded DOCX contains the selected text.

- [ ] **Step 2: Run the scenario and correct integration failures**

```bash
pnpm exec playwright test tests/e2e/inspection-flow.spec.ts tests/e2e/word-export.spec.ts --project=mobile-360
```

- [ ] **Step 3: Add template persistence coverage**

Verify the browser can create a global category/option, assign an item override, reload offline, and still use the default option. Verify a previously saved inspection retains its old label after the template is renamed.

- [ ] **Step 4: Commit end-to-end coverage**

```bash
git add app/tests/e2e/inspection-flow.spec.ts app/tests/e2e/word-export.spec.ts app/tests/e2e/offline-resume.spec.ts app/src/features/review/ReviewPage.test.tsx app/src/features/reports/reportModel.test.ts
git commit -m "test: cover no-photo review and template workflows"
```

### Task 8: Full verification, Android versioning, and handoff

**Files:**
- Modify: `app/android/app/build.gradle`
- Modify: `output/doc/7S巡检项目交接资料-Reasonix到Codex-20260806.md` only if a new handoff is explicitly requested

**Interfaces:**
- Consumes: all previous tasks and current release workflow.
- Produces: verified web build, Android debug APK, checksums, and a release-ready status report.

- [ ] **Step 1: Run focused and full web checks**

```bash
cd C:\Users\xj\Desktop\7s管理\app
pnpm exec vitest run src/db/repositories.test.ts src/features/review/ReviewPage.test.tsx src/features/reports/reportModel.test.ts --maxWorkers=1
pnpm exec vitest run --maxWorkers=1
pnpm lint
pnpm build
```

- [ ] **Step 2: Run Playwright regression**

```bash
pnpm exec playwright test tests/e2e/inspection-flow.spec.ts tests/e2e/word-export.spec.ts tests/e2e/offline-resume.spec.ts
```

- [ ] **Step 3: Increment Android version and build**

Set `versionName` to `1.1.0` and `versionCode` to `11`, then run:

```bash
pnpm exec cap copy android
cd C:\Users\xj\Desktop\7s管理\app\android
.\gradlew.bat lintDebug assembleDebug
```

- [ ] **Step 4: Verify APK and worktree**

Copy the debug APK to an ASCII filename under `output`, compute SHA-256, inspect `git status --short`, and ensure only intended source/docs/build metadata are tracked. Do not claim a release until the APK and tests are verified.

- [ ] **Step 5: Commit version metadata**

```bash
git add app/android/app/build.gradle
git commit -m "chore: release v1.1.0 inspection content templates"
```
