# 无照片检查项评价实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许没有照片的检查项选择四类评价并以此标记已检查，同时让 Word 只输出实际有照片的评价组。

**Architecture:** 复用现有 `PhotoGroup` 作为检查项评价记录，新增 `InspectionRepository.addEvaluationGroup()` 创建 `photoIds: []` 的空评价组。巡检页在没有评价组时显示分类选择器，选择成功后接入现有 `PhotoGroupEditor`；完成状态只看是否存在评价组。报告校验继续校验空组的分类、说明和奖考数据，但不再因空照片数组报错；报告模型继续过滤空组。

**Tech Stack:** React 19、TypeScript 6、Vitest 4、Testing Library、Dexie 4、Vite 8、Capacitor Android 8.4.2、Gradle。

## Global Constraints

- 用户可见分类固定为“好的方面、一般表现、提醒问题、考核问题”，不使用“做的一般”或“作弊班”。
- 无评价组的检查项为未检查；存在任意评价组即为已检查，不再要求照片或检查内容选择作为完成前提。
- 空评价组不生成 Word 正文、编号、章节标题或照片区域。
- 有无照片的“考核问题”均要求考核人员和正数金额；好的方面奖励规则、一般表现/提醒问题奖考兼容规则保持不变。
- 整份报告仍至少需要一张实际归组照片；不取消 `REPORT_PHOTO_REQUIRED`。
- 保留当前四分类未提交修改、历史模板、原图、照片备份、压缩逻辑和固定 3:4 Word 画幅。
- 不发布 GitHub Release；本轮只做本地测试和本地 APK 产物。
- 从 `C:/Users/xj/Desktop/7s管理/app` 执行 pnpm、Vitest、lint 和 build 命令；Android 构建从 `app/android` 执行。

---

### Task 1: Add Empty Evaluation Group Persistence

**Files:**
- Modify: `app/src/db/inspectionRepository.ts:425-810`
- Modify: `app/src/app/dependencies.ts:35-75`
- Test: `app/src/db/repositories.test.ts` near the existing review-status and photo-group persistence tests

**Interfaces:**
- Add `EvaluationGroupAppendResult` in `app/src/db/inspectionRepository.ts`:

```ts
export interface EvaluationGroupAppendResult {
  entry: InspectionEntry;
  group: PhotoGroup;
  updatedAt: string;
}
```

- Add this repository method:

```ts
addEvaluationGroup(
  entryId: string,
  category: PhotoCategory,
  groupId: string,
  updatedAt?: string,
): Promise<EvaluationGroupAppendResult>;
```

- Add the same method to `InspectionRepositoryPort` in `app/src/app/dependencies.ts`, importing the result type from `inspectionRepository.ts` alongside `PhotoAppendResult`.

- [ ] **Step 1: Write the failing repository tests**

Add a test to the repository test suite that saves an inspection with one entry and no groups, creates a reminder evaluation, then reloads the graph:

```ts
test("creates and reloads an empty evaluation group", async () => {
  const db = testDb("empty-evaluation-group");
  const repository = new InspectionRepository(db);
  const base = makeInspection();
  const inspection = {
    ...base,
    entries: [{ ...base.entries[0]!, groupIds: [] }],
  };
  await repository.saveGraph({ inspection, groups: [], photos: [] });

  const result = await repository.addEvaluationGroup(
    "entry-1",
    "reminder",
    "group-empty",
    "2026-08-04T10:00:00.000Z",
  );

  expect(result.group).toMatchObject({
    id: "group-empty",
    entryId: "entry-1",
    category: "reminder",
    description: inspection.entries[0]!.itemSnapshot.reminderText,
    awardAssessment: null,
    photoIds: [],
    order: 0,
  });
  expect(result.entry.groupIds).toEqual(["group-empty"]);
  expect(result.updatedAt).toBe("2026-08-04T10:00:00.000Z");

  const restored = await repository.getGraph("inspection-1");
  expect(restored?.groups).toEqual([result.group]);
  expect(restored?.inspection.entries[0]?.groupIds).toEqual(["group-empty"]);
  expect(restored?.inspection.status).toBe("draft");
});
```

Add a second test proving invalid ownership and duplicate IDs are rejected without partial writes:

```ts
test("rejects an empty evaluation group for a missing entry or duplicate group id", async () => {
  const db = testDb("empty-evaluation-group-integrity");
  const repository = new InspectionRepository(db);
  await repository.saveGraph({ inspection: makeInspection(), groups: [], photos: [] });

  await expect(repository.addEvaluationGroup("missing-entry", "good", "group-new"))
    .rejects.toThrow("巡检条目 missing-entry 不存在");

  await repository.addEvaluationGroup("entry-1", "good", "group-existing");
  await expect(repository.addEvaluationGroup("entry-1", "assessment", "group-existing"))
    .rejects.toThrow("照片组 group-existing 已存在");

  const restored = await repository.getGraph("inspection-1");
  expect(restored?.groups).toHaveLength(1);
  expect(restored?.inspection.entries[0]?.groupIds).toEqual(["group-existing"]);
});
```

- [ ] **Step 2: Run the repository tests and verify the intended red failure**

Run from `app`:

```powershell
pnpm exec vitest run src/db/repositories.test.ts -t "empty evaluation group"
```

Expected: FAIL because `InspectionRepository.addEvaluationGroup` and the port type do not exist yet. Existing unrelated repository tests must still collect.

- [ ] **Step 3: Implement the repository method**

Import `descriptionForCategory` from `../domain/inspection` and `photoCategorySchema` from `../domain/schemas` if not already imported. Implement the transaction next to `addPhotoToGoodGroup`:

```ts
async addEvaluationGroup(
  entryId: string,
  category: PhotoCategory,
  groupId: string,
  updatedAt = new Date().toISOString(),
): Promise<EvaluationGroupAppendResult> {
  const parsedCategory = photoCategorySchema.safeParse(category);
  if (!parsedCategory.success) throw new GraphIntegrityError("照片组分类无效。");
  requireId(groupId, "照片组");

  return this.db.transaction(
    "rw",
    this.db.inspections,
    this.db.entries,
    this.db.photoGroups,
    async () => {
      const entry = await requireRow(
        await this.db.entries.get(entryId),
        `巡检条目 ${entryId} 不存在。`,
      );
      const inspection = await requireRow(
        await this.db.inspections.get(entry.inspectionId),
        `巡检记录 ${entry.inspectionId} 不存在。`,
      );
      if (inspection.deletedAt !== null) throw new GraphIntegrityError("巡检记录已删除。");
      if (await this.db.photoGroups.get(groupId)) {
        throw new GraphIntegrityError(`照片组 ${groupId} 已存在。`);
      }

      const group: PhotoGroup = {
        id: groupId,
        inspectionId: inspection.id,
        entryId: entry.id,
        category,
        description: descriptionForCategory(entry.itemSnapshot as ChecklistItem, category),
        descriptionManuallyEdited: false,
        awardAssessment: null,
        photoIds: [],
        order: entry.groupIds.length,
      };
      const storedEntry = { ...entry, groupIds: [...entry.groupIds, group.id] };
      await this.db.photoGroups.add(group);
      await this.db.entries.put(storedEntry);
      const updated = await this.db.inspections.update(inspection.id, {
        status: "draft",
        updatedAt,
      });
      if (updated !== 1) throw new GraphIntegrityError(`巡检记录 ${inspection.id} 更新失败。`);
      return { entry: storedEntry, group, updatedAt };
    },
  );
}
```

Use the existing repository imports and error messages where their current names differ; keep the transaction limited to the inspection, entry, and photo-group tables because no photo row is created.

- [ ] **Step 4: Run the repository tests and verify green**

```powershell
pnpm exec vitest run src/db/repositories.test.ts -t "empty evaluation group"
```

Expected: both new tests pass and the output contains zero failed tests.

- [ ] **Step 5: Commit the persistence slice**

Stage only the repository interface, implementation, and repository test file, then commit:

```powershell
git add -- app/src/db/inspectionRepository.ts app/src/app/dependencies.ts app/src/db/repositories.test.ts
git commit -m "feat: persist photo-free evaluations"
```

If a staged file already contains the earlier four-category changes, retain those changes in the commit; do not reset or restore the file.

### Task 2: Add No-Photo Category Picker And Completion State

**Files:**
- Modify: `app/src/features/inspections/InspectionEntryEditor.tsx:1-220`
- Modify: `app/src/features/inspections/InspectionItemSheet.tsx:15-150`
- Modify: `app/src/features/inspections/InspectionPage.tsx:47-90,420-470,700-730`
- Modify: `app/src/features/inspections/InspectionEntrySummary.tsx:7-40`
- Modify: `app/src/features/review/ReviewPage.tsx:200-290,660-682`
- Modify: `app/src/styles/global.css:916-963`
- Test: `app/src/features/inspections/InspectionEntryEditor.test.tsx`
- Test: `app/src/features/inspections/InspectionEntrySummary.test.tsx`
- Test: `app/src/features/inspections/inspection-flow.test.tsx`
- Test: `app/src/features/inspections/group-evaluation.test.tsx`

**Interfaces:**
- Extend `InspectionEntryEditorProps` with:

```ts
onCreatePhotoGroup(category: PhotoCategory): Promise<void>;
```

- Extend `InspectionItemSheetProps` with the same callback and pass it through to `InspectionEntryEditor`.
- `InspectionPage` and the review route editor both call `inspectionRepository.addEvaluationGroup(entry.id, category, createBrowserUuid())` and merge the returned `entry` and `group` into the current graph.

- [ ] **Step 1: Write the failing component tests**

Add this test to `InspectionEntryEditor.test.tsx`:

```tsx
test("shows all four evaluation choices when an entry has no photos or evaluation group", async () => {
  const user = userEvent.setup();
  const onCreatePhotoGroup = vi.fn().mockResolvedValue(undefined);
  const entry = makeInspection().entries[0]!;

  render(
    <InspectionEntryEditor
      entry={{ ...entry, groupIds: [] }}
      groups={[]}
      photos={[]}
      checklistItem={makeChecklistItem()}
      disabled={false}
      onFilesSelected={vi.fn()}
      onSaveCheckSelections={vi.fn().mockResolvedValue(undefined)}
      onSavePhotoGroup={vi.fn().mockResolvedValue(undefined)}
      onCreatePhotoGroup={onCreatePhotoGroup}
      onSplit={vi.fn().mockResolvedValue(undefined)}
      onPhotoSave={vi.fn().mockResolvedValue(undefined)}
      onDeletePhoto={vi.fn()}
      onReplacePhoto={vi.fn()}
      onHighQualityChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("radio", { name: "好的方面" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "一般表现" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "提醒问题" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "考核问题" })).toBeVisible();

  await user.click(screen.getByRole("radio", { name: "考核问题" }));
  expect(onCreatePhotoGroup).toHaveBeenCalledWith("assessment");
});
```

Update the existing direct `InspectionEntryEditor` test to pass `onCreatePhotoGroup={vi.fn().mockResolvedValue(undefined)}`.

Add a completion assertion to `InspectionEntrySummary.test.tsx` with a group whose `photoIds` is empty:

```tsx
test("marks an empty evaluation group as complete without a photo", () => {
  const entry = makeInspection().entries[0]!;
  const group = makePhotoGroup({ photoIds: [] });
  render(<InspectionEntrySummary entry={entry} groups={[group]} onOpen={vi.fn()} />);

  const opener = screen.getByRole("button", { name: /焊机间/ });
  expect(opener).toHaveAttribute("data-photo-count", "0");
  expect(opener).toHaveAttribute("data-complete", "true");
  expect(opener).toHaveTextContent("已完成");
});
```

Add an integration test to `inspection-flow.test.tsx` that creates a no-group graph, opens the item, selects `一般表现`, waits for `repository.getGraph("inspection-1")` to contain one empty general group, verifies the summary is complete, unmounts, reloads, and verifies the general radio remains checked. The test must not add any photo or check-content selection.

- [ ] **Step 2: Run the new component tests and verify the intended red failure**

```powershell
pnpm exec vitest run src/features/inspections/InspectionEntryEditor.test.tsx src/features/inspections/InspectionEntrySummary.test.tsx src/features/inspections/inspection-flow.test.tsx -t "empty|four evaluation|complete without"
```

Expected: FAIL because the editor has no empty-entry picker and the completion condition still requires a photo/check selection.

- [ ] **Step 3: Add the empty-entry picker and graph append helper**

In `InspectionEntryEditor.tsx`, add a local `EmptyEvaluationPicker` component using `PHOTO_CATEGORIES`, `useId`, and controlled `pendingCategory` state. It must render the same four accessible radio labels as `PhotoGroupEditor`; while `onCreatePhotoGroup` is pending, disable the radios; on rejection, clear the pending selection so the user can retry.

Render the picker only when `groups.length === 0`:

```tsx
{groups.length === 0 ? (
  <EmptyEvaluationPicker
    disabled={disabled}
    onCreatePhotoGroup={onCreatePhotoGroup}
  />
) : null}
```

Keep the existing `PhotoGroupEditor` map unchanged for non-empty groups and for an already-created empty group.

In `InspectionPage.tsx`, add `appendEvaluationGroupToGraph` next to `appendPhotoToGraph`:

```ts
function appendEvaluationGroupToGraph(
  graph: InspectionGraph,
  result: EvaluationGroupAppendResult,
): InspectionGraph {
  return {
    ...graph,
    inspection: {
      ...graph.inspection,
      updatedAt: result.updatedAt,
      entries: graph.inspection.entries.map((entry) =>
        entry.id === result.entry.id ? result.entry : entry),
    },
    groups: [...graph.groups, result.group],
  };
}
```

Add `createEvaluationGroup(entryId, category)` beside `savePhotoGroup`. Guard it with the existing `processing`/`savingEntryIds` state, set `photoError` before the call, use `createBrowserUuid()`, update the graph only if the current inspection route still matches, and rethrow repository errors so the picker can reset:

```ts
async function createEvaluationGroup(entryId: string, category: PhotoCategory) {
  if (processing || savingEntryIds.has(entryId)) return;
  const generation = inspectionGeneration.current;
  const inspectionId = id;
  setSavingEntryIds((current) => new Set(current).add(entryId));
  setPhotoError("");
  try {
    const result = await inspectionRepository.addEvaluationGroup(
      entryId,
      category,
      createBrowserUuid(),
    );
    if (
      generation !== inspectionGeneration.current ||
      inspectionId !== currentInspectionId.current ||
      !isCurrentInspectionRoute(inspectionId)
    ) return;
    setGraph((current) => current && current.inspection.id === inspectionId
      ? appendEvaluationGroupToGraph(current, result)
      : current);
  } catch (error) {
    setPhotoError(error instanceof Error ? error.message : "评价保存失败");
    throw error;
  } finally {
    if (generation === inspectionGeneration.current && inspectionId === currentInspectionId.current) {
      setSavingEntryIds((current) => {
        const next = new Set(current);
        next.delete(entryId);
        return next;
      });
    }
  }
}
```

Pass `onCreatePhotoGroup={(category) => createEvaluationGroup(entry.id, category)}` from `InspectionPage` to `InspectionItemSheet` and from `InspectionItemSheet` to `InspectionEntryEditor`.

- [ ] **Step 4: Change completion conditions and wire review editing**

Change both completion calculations to use evaluation-group presence:

```ts
const complete = groups.length > 0;
```

and:

```ts
function routeIsComplete(entries: InspectionEntry[], groups: PhotoGroup[]): boolean {
  return entries.length > 0 && entries.every((entry) =>
    groups.some((group) => group.entryId === entry.id),
  );
}
```

In `ReviewPage.tsx`, add `createEditEvaluationGroup(entryId, category)` beside `saveEditPhotoGroup`. It must set `editError`, call `addEvaluationGroup(entryId, category, createBrowserUuid())`, refresh the graph, and rethrow the original error. Pass it to the route editor as `onCreatePhotoGroup`.

Keep `visibleGroups` filtered by `photoIds.length > 0` so review tabs, photo counts, drag-and-drop, and Word-facing review content do not include empty groups. The route editor may edit an empty group when its route is open; the primary creation path remains the inspection page.

Change `.category-segments` in `app/src/styles/global.css` to four equal columns so the new empty-entry picker and existing four-category editor have a stable layout:

```css
.category-segments {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
```

- [ ] **Step 5: Run the focused UI tests and verify green**

```powershell
pnpm exec vitest run src/features/inspections/InspectionEntryEditor.test.tsx src/features/inspections/InspectionEntrySummary.test.tsx src/features/inspections/inspection-flow.test.tsx src/features/inspections/group-evaluation.test.tsx
```

Expected: the new no-photo selection, persistence/reload, and completion assertions pass; existing photo group category/split tests remain green.

- [ ] **Step 6: Commit the UI and completion slice**

```powershell
git add -- app/src/features/inspections/InspectionEntryEditor.tsx app/src/features/inspections/InspectionItemSheet.tsx app/src/features/inspections/InspectionPage.tsx app/src/features/inspections/InspectionEntrySummary.tsx app/src/features/review/ReviewPage.tsx app/src/styles/global.css app/src/features/inspections/InspectionEntryEditor.test.tsx app/src/features/inspections/InspectionEntrySummary.test.tsx app/src/features/inspections/inspection-flow.test.tsx app/src/features/inspections/group-evaluation.test.tsx
git commit -m "feat: complete inspections with photo-free evaluations"
```

### Task 3: Allow Empty Groups Through Report Validation

**Files:**
- Modify: `app/src/domain/reportValidation.ts:20-65`
- Test: `app/src/domain/reportValidation.test.ts:127-265`
- Test: `app/src/db/repositories.test.ts` near generation-readiness tests

**Interfaces:**
- `validateReportReadiness(graph)` continues returning `ReportValidationError[]`.
- `validateGroup(group)` continues validating category, description, award compatibility, and assessment/reward details; only the `EMPTY_PHOTO_GROUP` branch is removed.

- [ ] **Step 1: Write the failing validation tests**

Add a graph fixture containing one photographed good group and one empty general group linked to the same entry. Assert the empty group does not produce `EMPTY_PHOTO_GROUP`:

```ts
test("accepts an empty evaluation group when another group supplies report photos", () => {
  const base = makeInspection();
  const empty = makePhotoGroup({ id: "group-empty", category: "general", photoIds: [], order: 0 });
  const photographed = makePhotoGroup({ id: "group-photo", photoIds: ["photo-1"], order: 1 });
  const graph = makeGraph({
    inspection: {
      ...base,
      entries: [{ ...base.entries[0]!, groupIds: [empty.id, photographed.id] }],
    },
    groups: [empty, photographed],
  });

  expect(validateReportReadiness(graph).map((error) => error.code)).not.toContain(
    "EMPTY_PHOTO_GROUP",
  );
});
```

Add an empty assessment group with a photographed good group and assert `ASSESSMENT_DETAILS_REQUIRED` remains present until people and amount are supplied. Also update the existing “rejects empty group content” expectation to retain `EMPTY_DESCRIPTION` for blank descriptions but remove the obsolete `EMPTY_PHOTO_GROUP` code.

- [ ] **Step 2: Run the validation tests and verify the intended red failure**

```powershell
pnpm exec vitest run src/domain/reportValidation.test.ts -t "empty evaluation|empty group content|assessment"
```

Expected: the new acceptance test fails only because `EMPTY_PHOTO_GROUP` is still emitted; the assessment-details assertion remains failing only if the fixture or expectation is incorrect.

- [ ] **Step 3: Remove only the empty-photo validation branch**

In `validateGroup` remove:

```ts
if (group.photoIds.length === 0) {
  errors.push(error(group.id, "photoIds", "EMPTY_PHOTO_GROUP", "照片组至少需要一张照片。"));
}
```

Leave the description and award/assessment validation branches unchanged. Keep the top-level `graph.photos.length === 0` check so a graph containing only empty evaluation groups still returns `REPORT_PHOTO_REQUIRED`.

- [ ] **Step 4: Run the validation and repository readiness tests**

```powershell
pnpm exec vitest run src/domain/reportValidation.test.ts src/db/repositories.test.ts -t "empty evaluation|empty group content|assessment|no photos"
```

Expected: empty general groups do not block a graph with real photos, empty assessment groups still require people and amount, and a graph with no actual photos still rejects generation with `REPORT_PHOTO_REQUIRED`.

- [ ] **Step 5: Commit the validation slice**

```powershell
git add -- app/src/domain/reportValidation.ts app/src/domain/reportValidation.test.ts app/src/db/repositories.test.ts
git commit -m "fix: validate photo-free evaluation groups"
```

### Task 4: Prove Word Filtering And Assessment Rules

**Files:**
- Modify: `app/src/features/reports/reportModel.test.ts`
- Modify: `app/src/features/reports/generateDocx.test.ts` only if a report-model test exposes a generator regression
- Modify: `app/src/features/review/ReviewPage.test.tsx` for an empty assessment editing/readiness regression

**Interfaces:**
- `buildReportModel(graph, template)` continues returning `ReportModel` with only photographed groups in `sections`.
- No production change is expected in `reportModel.ts` because it already selects `graph.groups.filter((group) => group.photoIds.length > 0)`; a failing test is required before changing it.

- [ ] **Step 1: Write the failing report-model test**

Add a test that builds a graph with an empty general group and a photographed good group, then asserts only the good group appears:

```ts
test("omits photo-free evaluation groups from the Word report model", () => {
  const base = makeInspection();
  const empty = makePhotoGroup({ id: "group-empty", category: "general", photoIds: [], order: 0 });
  const photographed = makePhotoGroup({ id: "group-photo", photoIds: ["photo-1"], order: 1 });
  const graph = {
    ...makeGraph({
      inspection: { ...base, entries: [{ ...base.entries[0]!, groupIds: [empty.id, photographed.id] }] },
      groups: [empty, photographed],
    }),
  };

  const model = buildReportModel(graph, graph.template!);
  expect(model.sections.flatMap((section) => section.groups.map((group) => group.id)))
    .toEqual(["group-photo"]);
});
```

Add a test for an empty assessment group with complete `{ type: "assessment", people: "张三", amount: 50 }` showing `validateReportReadiness` has no assessment-details error, and a second assertion with missing details showing the error. The report model assertion must still show that the empty group contributes no section/group.

- [ ] **Step 2: Run report tests and verify the red/green evidence**

```powershell
pnpm exec vitest run src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts src/domain/reportValidation.test.ts -t "photo-free|assessment|empty"
```

Expected: the filtering test passes against the existing implementation after the fixture is valid; the validation assertions prove the empty assessment rule. If the filtering test passes immediately, keep the test as regression coverage and do not change `reportModel.ts`.

- [ ] **Step 3: Add review-page coverage for empty assessment details**

Create a review graph with one photographed good group and one empty assessment group. Assert the review page shows the global validation message for missing assessment details and keeps “生成Word” disabled. Update the graph with a complete assessment object, rerender/refresh, and assert the assessment-details message disappears while the empty group remains absent from the photo tabs.

- [ ] **Step 4: Run the focused report/review tests**

```powershell
pnpm exec vitest run src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts src/features/review/ReviewPage.test.tsx src/domain/reportValidation.test.ts
```

Expected: report generation, four-category template behavior, no-photo filtering, and empty assessment validation all pass.

- [ ] **Step 5: Commit report coverage**

```powershell
git add -- app/src/features/reports/reportModel.test.ts app/src/features/reports/generateDocx.test.ts app/src/features/review/ReviewPage.test.tsx app/src/domain/reportValidation.test.ts
git commit -m "test: cover photo-free report evaluations"
```

### Task 5: Full Verification And Local Android Artifact

**Files:**
- No planned production source changes.
- Generated artifact: `C:/Users/xj/Desktop/7s管理/output/7S-inspection-v1.0.4-no-photo-evaluation.apk`

**Interfaces:**
- Web and Android builds must consume the same completed TypeScript implementation.
- The existing `app/android/app/build.gradle` version remains `1.0.4` / `versionCode 5`; do not bump it again for this feature.

- [ ] **Step 1: Run the focused regression suite**

```powershell
pnpm exec vitest run src/db/repositories.test.ts src/features/inspections/InspectionEntryEditor.test.tsx src/features/inspections/InspectionEntrySummary.test.tsx src/features/inspections/inspection-flow.test.tsx src/features/inspections/group-evaluation.test.tsx src/domain/reportValidation.test.ts src/features/reports/reportModel.test.ts src/features/review/ReviewPage.test.tsx
```

Expected: zero failed tests and no unhandled rejection output.

- [ ] **Step 2: Run the complete one-worker and stress suites**

```powershell
pnpm test:run -- --maxWorkers=1
pnpm test:stress -- --maxWorkers=1
```

Expected: every Vitest file/case passes, including the existing photo compression and four-category tests.

- [ ] **Step 3: Run lint, web build, and E2E**

```powershell
pnpm lint
pnpm build
pnpm test:e2e
```

Expected: all three commands exit with code 0; E2E continues to cover inspection flow, offline resume, photo import, route templates, and Word export.

- [ ] **Step 4: Sync Capacitor and build Android from the ASCII path**

From `C:/Users/xj/Desktop/7s管理/app` run:

```powershell
pnpm exec cap sync android
```

Then from `C:/Users/xj/Desktop/7s管理/app/android`, with JDK 21 selected:

```powershell
./gradlew.bat lintDebug assembleDebug
```

Expected: Android lint and `assembleDebug` exit 0. The generated APK is `app/android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 5: Copy and verify the local APK without replacing the prior artifact**

```powershell
Copy-Item -LiteralPath app/android/app/build/outputs/apk/debug/app-debug.apk -Destination output/7S-inspection-v1.0.4-no-photo-evaluation.apk -Force
Get-Item -LiteralPath output/7S-inspection-v1.0.4-no-photo-evaluation.apk | Select-Object FullName,Length,LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath output/7S-inspection-v1.0.4-no-photo-evaluation.apk
```

Verify the package/version using the bundled Android SDK `apkanalyzer` or the same local verification command used for the previous 1.0.4 build. Record the file size and SHA-256 in the final response; do not publish a release.

- [ ] **Step 6: Run final repository checks**

```powershell
git diff --check
git status --short --branch
git log -6 --oneline --decorate
```

Expected: no whitespace errors; prior four-category modifications remain present; the new feature files are either committed by the task commits or clearly listed; no credentials, token files, historical templates, or prior APK artifact were removed.

- [ ] **Step 7: Finish with a verified handoff**

Report the exact focused/full test counts, lint/build/E2E exit results, Android lint/assemble result, APK path, size, and SHA-256. State explicitly if any command could not run and include its exact failure instead of claiming completion.
