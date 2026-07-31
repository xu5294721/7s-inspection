# Inspection Route Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized future-inspection checklist with 39 one-item routes and add reusable, persistent inspection route templates with full-select, clear-all, and custom-route creation.

**Architecture:** Add an `InspectionRouteTemplate` domain model and an IndexedDB `routeTemplates` table, kept separate from immutable Word report templates. Seed and migrate a stable 39-item route catalog without touching historical inspection snapshots, then drive the new-inspection UI from a selected route template. Extend backup schema version 2 while accepting version 1 archives.

**Tech Stack:** React 19, TypeScript 6, React Router 7, Dexie 4/IndexedDB, Zod 4, Vitest/Testing Library, Playwright, existing PWA and DOCX pipeline.

## Global Constraints

- The fixed catalog contains exactly the 39 names and order in `docs/superpowers/specs/2026-07-29-inspection-route-templates-design.md`.
- Each route name creates exactly one inspection entry.
- Photos retain exactly three categories: `good`, `reminder`, and `assessment`.
- A temporary selection change never writes back to the selected route template.
- A custom route persists, is added atomically to the current template, and is selected for the current inspection.
- Unselected routes never enter the draft; selected routes without photographed groups never appear in Word.
- Existing inspections, photos, classifications, assessment amounts, and immutable Word template versions must not change.
- 历史巡检必须继续使用其不可变项目快照，任何路线项目或路线模板迁移不得改写历史内容。
- Do not modify the three original DOCX files.
- Do not use Git or change Git configuration; record checkpoints in `.superpowers/sdd/progress.md`.

---

## File Structure

**Create:**

- `app/src/data/core-inspection-items.ts`: stable 39-item catalog and factory for one-entry checklist items.
- `app/src/db/routeTemplateRepository.ts`: route-template validation, CRUD, and atomic custom-item insertion.
- `app/src/app/routeCatalogMigration.ts`: idempotent old-catalog disablement and default-template initialization.
- `app/src/features/routeTemplates/RouteTemplateManagementPage.tsx`: template list and editor workflow.
- `app/src/features/routeTemplates/RouteTemplateEditor.tsx`: focused template name and route-selection form.
- `app/src/features/routeTemplates/route-template-management.test.tsx`: route-template UI behavior.
- `app/src/features/inspections/CustomRouteDialog.tsx`: accessible custom-route name dialog.
- `app/src/features/inspections/route-selection.test.tsx`: new-inspection template and selection behavior.
- `app/tests/e2e/route-templates.spec.ts`: mobile end-to-end route-template workflow.

**Modify:**

- `app/src/domain/models.ts`, `app/src/domain/schemas.ts`: route-template model and schema.
- `app/src/db/database.ts`: Dexie version 2 and `routeTemplates` table.
- `app/src/app/dependencies.ts`, `app/src/app/useAppDependencies.ts`: repository port and initialization.
- `app/src/db/backupRepository.ts`, `app/src/db/backupRepository.test.ts`: schema v2 export plus v1 restore compatibility.
- `app/src/db/repositories.test.ts`, `app/src/app/dependencies.test.ts`: repository and migration coverage.
- `app/src/features/inspections/NewInspectionPage.tsx`, `ChecklistRouteList.tsx`, `inspection-flow.test.tsx`: route-template-driven selection.
- `app/src/app/router.tsx`, `app/src/styles/global.css`: template management route and mobile layout.
- `app/src/features/reports/reportModel.test.ts`: empty-entry Word omission regression.
- `app/tests/e2e/inspection-helpers.ts`, `inspection-flow.spec.ts`, `word-export.spec.ts`: adapt helpers to one-entry routes and inspect generated DOCX omission.
- `.superpowers/sdd/progress.md`: task checkpoints and verification evidence.

---

### Task 1: Route Template Domain and Repository

**Files:**

- Modify: `app/src/domain/models.ts`
- Modify: `app/src/domain/schemas.ts`
- Modify: `app/src/db/database.ts`
- Create: `app/src/db/routeTemplateRepository.ts`
- Test: `app/src/db/repositories.test.ts`

**Interfaces:**

- Produces: `InspectionRouteTemplate`, `inspectionRouteTemplateSchema`.
- Produces: `RouteTemplateRepository.list()`, `get(id)`, `save(template)`, `remove(id)`, and `addCustomItem(templateId, item)`.
- `addCustomItem` writes the checklist item and updated template in one Dexie transaction.

- [ ] **Step 1: Write failing model and repository tests**

Add tests that require trimmed unique names, nonempty deduplicated `itemIds`, one protected default, sorted listing, CRUD, and rollback when custom-item insertion conflicts:

```ts
const template: InspectionRouteTemplate = {
  id: "route-template-default",
  name: "默认模板",
  itemIds: ["core-route-01", "core-route-02"],
  isDefault: true,
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

expect(inspectionRouteTemplateSchema.safeParse(template).success).toBe(true);
await repository.save(template);
await expect(repository.remove(template.id)).rejects.toThrow("默认模板不能删除");
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --run src/db/repositories.test.ts`

Expected: FAIL because `InspectionRouteTemplate`, the schema, table, and repository do not exist.

- [ ] **Step 3: Add the domain model and schema**

```ts
export interface InspectionRouteTemplate {
  id: string;
  name: string;
  itemIds: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const inspectionRouteTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  itemIds: z.array(z.string().min(1)).min(1),
  isDefault: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((value, context) => {
  if (new Set(value.itemIds).size !== value.itemIds.length) {
    context.addIssue({ code: "custom", path: ["itemIds"], message: "模板项目不能重复。" });
  }
});
```

- [ ] **Step 4: Add Dexie version 2 and repository operations**

Keep all version 1 stores unchanged and add:

```ts
routeTemplates!: Table<InspectionRouteTemplate, string>;

this.version(2).stores({
  checklistItems: "id, routeOrder, routeName, area, device, enabled, updatedAt",
  inspections: "id, inspectionDate, status, updatedAt, deletedAt",
  entries: "id, inspectionId, itemId, [inspectionId+order]",
  photoGroups: "id, inspectionId, entryId, category, [inspectionId+order]",
  photos: "id, inspectionId, groupId, [groupId+order], capturedAt",
  templates: "[id+version], id, version, name",
  routeTemplates: "id, &name, isDefault, updatedAt",
  settings: "key",
});
```

Repository validation must reject empty templates, duplicate names, missing or disabled item IDs, deleting the default, and creation of a second default. `addCustomItem` must check item-name uniqueness and append the new ID to the current template in a single transaction.

- [ ] **Step 5: Run repository tests**

Run: `npm test -- --run src/db/repositories.test.ts`

Expected: PASS, including rollback and protected-default cases.

- [ ] **Step 6: Record checkpoint**

Append Task 13.1 evidence to `.superpowers/sdd/progress.md`; do not run Git commands.

---

### Task 2: Stable 39-Item Catalog and Idempotent Migration

**Files:**

- Create: `app/src/data/core-inspection-items.ts`
- Create: `app/src/app/routeCatalogMigration.ts`
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/app/dependencies.test.ts`
- Modify: `app/src/features/inspections/inspection-flow.test.tsx`

**Interfaces:**

- Produces: `CORE_INSPECTION_ROUTE_NAMES`, `createCoreInspectionItems(timestamp)`.
- Produces: `ensureRouteCatalog(db, timestamp?)` returning `{ inserted, disabledLegacy, defaultTemplateCreated }`.
- Consumes legacy built-in IDs from `default-checklist-items.json` only to identify records to disable.

- [ ] **Step 1: Write failing catalog and migration tests**

Cover empty database, a database containing all legacy built-ins, preservation of a user-created item, repeat initialization, stable ordering, and a historical snapshot whose legacy item remains unchanged.

```ts
expect(CORE_INSPECTION_ROUTE_NAMES).toHaveLength(39);
expect(CORE_INSPECTION_ROUTE_NAMES[30]).toBe("焊后间与门吊之间区域");
await ensureRouteCatalog(database, "2026-07-29T00:00:00.000Z");
expect((await routeTemplates.list())[0].itemIds).toHaveLength(39);
expect((await items.get("user-item"))?.enabled).toBe(true);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --run src/app/dependencies.test.ts src/features/inspections/inspection-flow.test.tsx`

Expected: FAIL because initialization still seeds 449 detailed items.

- [ ] **Step 3: Implement the stable catalog**

Use IDs `core-route-01` through `core-route-39`. For each item set `routeName`, `area`, and `part` to the route name, `standard` to `检查{名称}7S管理落实情况`, `team` to `相关责任工班`, and category descriptions to:

```ts
export const CORE_INSPECTION_ROUTE_NAMES = [
  "卷扬机间",
  "百米轨场平移小车",
  "热一线外围",
  "焊机工长办公室",
  "一线焊前检查",
  "二线焊前检查",
  "一线除锈机",
  "二线除锈机",
  "一线锯床",
  "二线锯床",
  "一线焊机",
  "二线焊机",
  "一线打标机",
  "二线打标机",
  "一线粗铣",
  "二线粗铣",
  "二线抛光机",
  "一线机械臂",
  "二线机械臂",
  "一线正火",
  "二线正火",
  "一线精调",
  "二线精调",
  "一线精铣机",
  "二线精铣机",
  "入库验收",
  "一线探伤间",
  "二线探伤间",
  "机械臂至正火间区域",
  "热一、二辊道线",
  "焊后间与门吊之间区域",
  "维修工班办公室与机加工间",
  "质检工班办公室及间休室",
  "综合楼三楼劳务工休息室",
  "运输工班办公室及间休室",
  "装整工班办公室",
  "装整工班钢轨整修间辊道梁",
  "生产综合班办公室",
  "仓库外围院子",
] as const;

goodText: `${name}7S管理落实较好。`,
reminderText: `${name}存在7S管理不到位问题，本次予以提醒。`,
assessmentText: `${name}存在7S管理不到位问题。`,
```

- [ ] **Step 4: Implement one-time migration**

Within one transaction over `checklistItems`, `routeTemplates`, and `settings`:

```ts
const ROUTE_CATALOG_VERSION_KEY = "inspectionRouteCatalogVersion";
const ROUTE_CATALOG_VERSION = 1;
```

Disable rows whose IDs are in the legacy JSON, preserve all other rows, insert missing stable core items, create `route-template-default` with exactly the 39 core IDs when absent, and write version `1`. Re-entry with version `1` must perform no destructive changes while still repairing a missing core item or default template.

- [ ] **Step 5: Replace old seeding in `initializeApp`**

Expose the route-template repository through `AppDependencies`, call `ensureRouteCatalog` before pages render, and retain Word-template seeding unchanged.

- [ ] **Step 6: Run migration tests**

Run: `npm test -- --run src/app/dependencies.test.ts src/features/inspections/inspection-flow.test.tsx`

Expected: PASS with 39 core items, one default route template, preserved user data, and unchanged historical snapshots.

- [ ] **Step 7: Record checkpoint**

Append Task 13.2 evidence to `.superpowers/sdd/progress.md`.

---

### Task 3: Backup Schema 2 and Schema 1 Compatibility

**Files:**

- Modify: `app/src/db/backupRepository.ts`
- Modify: `app/src/db/backupRepository.test.ts`
- Modify: `app/src/features/settings/BackupPage.tsx`
- Modify: `app/src/features/settings/BackupPage.test.tsx`

**Interfaces:**

- Backup v2 adds `data/route-templates.json` and `routeTemplates` counts.
- Parser accepts v1 with no route-template payload and normalizes it to `routeTemplates: []`.
- Merge conflict rule: identical ID/content skips; conflicting ID or name imports under a new ID and unique `（导入）` suffix.

- [ ] **Step 1: Write failing v2, v1, replace, and merge tests**

Add tests that inspect the ZIP manifest and payload, restore a hand-built valid v1 archive, preserve a v2 default template on replace, and import conflicting templates without overwriting local content.

```ts
expect(preview.schemaVersion).toBe(2);
expect(preview.counts.routeTemplates).toBe(1);
expect(await zip.file("data/route-templates.json")?.async("string")).toContain("默认模板");
```

- [ ] **Step 2: Run backup tests and confirm failure**

Run: `npm test -- --run src/db/backupRepository.test.ts src/features/settings/BackupPage.test.tsx`

Expected: FAIL because schema version 1 has no route-template payload.

- [ ] **Step 3: Add version-aware manifest parsing**

Define separate v1/v2 paths and schemas. New exports always use v2. During v1 parse, require only the seven original JSON files and return an empty route-template array; during v2 parse, require and validate `inspectionRouteTemplateSchema` rows.

- [ ] **Step 4: Extend snapshot, replace, and merge transactions**

Include `db.routeTemplates` in export and restore. In merge mode, compare normalized template content, allocate `imported-${originalId}-${counter}` IDs, and generate `名称（导入）`, `名称（导入2）` as needed. Return imported and skipped route-template counts in the preview/result UI.

- [ ] **Step 5: Ensure old restores receive a default template**

After a successful v1 replace or merge, call `ensureRouteCatalog(db)` so the current app can immediately open new-inspection without requiring a reload. Do not alter restored historical graphs.

- [ ] **Step 6: Run backup tests**

Run: `npm test -- --run src/db/backupRepository.test.ts src/features/settings/BackupPage.test.tsx`

Expected: PASS for v2 export, v1 parsing, replace, merge, conflict renaming, hash/count validation, and rollback.

- [ ] **Step 7: Record checkpoint**

Append Task 13.3 evidence to `.superpowers/sdd/progress.md`.

---

### Task 4: Route Template Management UI

**Files:**

- Create: `app/src/features/routeTemplates/RouteTemplateManagementPage.tsx`
- Create: `app/src/features/routeTemplates/RouteTemplateEditor.tsx`
- Create: `app/src/features/routeTemplates/route-template-management.test.tsx`
- Modify: `app/src/app/router.tsx`
- Modify: `app/src/styles/global.css`

**Interfaces:**

- Route: `/inspections/route-templates`.
- Uses `itemRepository.listEnabled()` and `routeTemplateRepository` CRUD.
- Default template name and deletion are locked; custom templates support create, rename, item changes, and confirmed deletion.

- [ ] **Step 1: Write failing component tests**

Cover list loading, create with selected items, select all, clear all, empty/name conflict validation, edit without touching inspection history, protected default controls, custom deletion confirmation, save failure retention, and keyboard-accessible dialogs.

```ts
await user.click(screen.getByRole("button", { name: "新建模板" }));
await user.type(screen.getByRole("textbox", { name: "模板名称" }), "模板1");
await user.click(screen.getByRole("button", { name: "全不选" }));
expect(screen.getByRole("button", { name: "保存模板" })).toBeDisabled();
```

- [ ] **Step 2: Run focused test and confirm failure**

Run: `npm test -- --run src/features/routeTemplates/route-template-management.test.tsx`

Expected: FAIL because the page and route do not exist.

- [ ] **Step 3: Implement list and editor state with validation**

Use `RouteTemplateManagementPage.tsx` for loading, mode selection, and delete confirmation. Use `RouteTemplateEditor.tsx` for name input, all/none controls, route checkboxes, validation, save, and cancel. Render an unframed page section, native checkboxes, compact icon-plus-text commands, and the existing confirmation-dialog pattern.

- [ ] **Step 4: Add mobile-safe styles**

Provide stable 44px controls, wrapping names, non-overlapping sticky actions, visible focus, and no horizontal overflow at 360px. Do not use nested cards or decorative gradients.

- [ ] **Step 5: Run UI tests and build**

Run: `npm test -- --run src/features/routeTemplates/route-template-management.test.tsx`

Run: `npm run build`

Expected: component tests PASS and TypeScript/Vite build succeeds.

- [ ] **Step 6: Record checkpoint**

Append Task 13.4 evidence to `.superpowers/sdd/progress.md`.

---

### Task 5: Template-Driven New Inspection and Custom Route Creation

**Files:**

- Create: `app/src/features/inspections/CustomRouteDialog.tsx`
- Create: `app/src/features/inspections/route-selection.test.tsx`
- Modify: `app/src/features/inspections/NewInspectionPage.tsx`
- Modify: `app/src/features/inspections/ChecklistRouteList.tsx`
- Modify: `app/src/features/inspections/inspection-flow.test.tsx`
- Modify: `app/src/styles/global.css`

**Interfaces:**

- Template selection loads `itemIds` into a temporary `Set<string>`.
- `ChecklistRouteList` receives one-item routes keyed by item ID and no longer renders a child-count label.
- `CustomRouteDialog` returns one trimmed name; parent calls atomic `addCustomItem` and selects the returned item ID.

- [ ] **Step 1: Write failing route-selection tests**

Cover default 39-item selection, template switching, temporary uncheck, full select, clear all, disabled start, custom addition, duplicate and save errors, exact one-entry creation, and unselected route omission.

```ts
expect(await screen.findAllByRole("checkbox")).toHaveLength(39);
await user.click(screen.getByRole("button", { name: "全不选" }));
await user.click(screen.getByRole("checkbox", { name: "卷扬机间" }));
await user.click(screen.getByRole("button", { name: "开始检查" }));
expect(stored.entries).toHaveLength(1);
expect(stored.entries[0].itemSnapshot.routeName).toBe("卷扬机间");
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --run src/features/inspections/route-selection.test.tsx src/features/inspections/inspection-flow.test.tsx`

Expected: FAIL because current selection groups the old library by route and has no templates.

- [ ] **Step 3: Implement template loading and temporary selection**

Load enabled items and templates together, select the default template initially, filter missing/disabled IDs, and replace the temporary set when the template changes. Render “全选”, “全不选”, “增加自定义”, and a link to `/inspections/route-templates`.

If a template references missing or disabled IDs, show “模板中有项目已停用，本次已自动忽略。” without rewriting the saved template. If loading fails, render “加载失败” and a retry button while preserving any already loaded selection.

- [ ] **Step 4: Implement custom-route dialog and atomic save**

Use the current maximum route order plus one and the same generic checklist fields as the core catalog. On success, reload items/templates, keep the current template selected, and add the returned item ID to the temporary set. On failure, leave dialog text and route selection intact.

- [ ] **Step 5: Create the draft from selected item IDs only**

```ts
const selectedItems = items.filter((item) => selectedItemIds.has(item.id));
const inspection = createInspection(selectedItems, inspectionId, inspectionDate);
```

Do not save the temporary set to the template. Preserve the existing immutable Word-template binding.

- [ ] **Step 6: Run route-selection tests**

Run: `npm test -- --run src/features/inspections/route-selection.test.tsx src/features/inspections/inspection-flow.test.tsx`

Expected: PASS, with one entry per selected name and no unselected entries.

- [ ] **Step 7: Record checkpoint**

Append Task 13.5 evidence to `.superpowers/sdd/progress.md`.

---

### Task 6: Word Omission Regression and Mobile End-to-End Flow

**Files:**

- Modify: `app/src/features/reports/reportModel.test.ts`
- Modify: `app/tests/e2e/inspection-helpers.ts`
- Modify: `app/tests/e2e/inspection-flow.spec.ts`
- Modify: `app/tests/e2e/word-export.spec.ts`
- Create: `app/tests/e2e/route-templates.spec.ts`
- Modify: `app/src/styles/global.css`

**Interfaces:**

- `buildReportModel` continues to derive sections and annex rows only from groups with at least one photo.
- E2E verifies “焊后间与门吊之间区域” omission when unchecked and when selected but left empty.

- [ ] **Step 1: Add report-model regression tests**

Construct a graph with three entries: one photographed, one unselected/absent, and one selected with no groups. Assert only the photographed route appears in sections and annex rows.

```ts
const model = buildReportModel(graphWithOnePhotographedAndOneEmptyEntry, template);
expect(JSON.stringify(model)).toContain("卷扬机间");
expect(JSON.stringify(model)).not.toContain("焊后间与门吊之间区域");
```

- [ ] **Step 2: Run report tests**

Run: `npm test -- --run src/features/reports/reportModel.test.ts`

Expected: PASS with current photographed-group filtering; if it fails, limit the implementation change to `buildReportModel` filtering.

- [ ] **Step 3: Add Playwright route-template workflow**

At both configured mobile viewports, create “模板1”, choose two routes, use it from new inspection, temporarily uncheck “焊后间与门吊之间区域”, add one custom route, start the inspection, and attach a real JPEG to one route. Generate the Word file, unzip `word/document.xml` in the test, and assert it contains the photographed route but does not contain “焊后间与门吊之间区域” or the selected route that received no photo.

- [ ] **Step 4: Verify layout and interaction invariants**

Assert no horizontal overflow, full project names wrap, bottom command bar does not cover the final route, dialogs remain operable at 360×800, and template switching does not resize controls.

- [ ] **Step 5: Run focused E2E**

Run: `npm run test:e2e -- route-templates.spec.ts inspection-flow.spec.ts`

Expected: PASS at 360×800 and 412×915.

- [ ] **Step 6: Record checkpoint**

Append Task 13.6 evidence to `.superpowers/sdd/progress.md`.

---

### Task 7: Full Regression, Review, and Trial Server

**Files:**

- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**

- No new interfaces; this task verifies the integrated feature and existing photo/Word workflows.

- [ ] **Step 1: Run the full unit suite twice**

Run twice: `npm run test:run`

Expected: all tests PASS on both runs with no unhandled rejection or worker error.

- [ ] **Step 2: Run specialized regression suites**

Run: `npm run test:stress`

Run: `npm run test:extract-default-items`

Expected: 100-photo stress and legacy extraction compatibility PASS.

- [ ] **Step 3: Run static verification**

Run: `npm run lint`

Run: `npm run build`

Expected: zero lint errors and successful production build.

- [ ] **Step 4: Run all mobile E2E tests**

Run: `npm run test:e2e`

Expected: all configured desktop/mobile projects PASS.

- [ ] **Step 5: Perform independent spec and quality reviews**

Review every requirement in `docs/superpowers/specs/2026-07-29-inspection-route-templates-design.md`, check backup compatibility and historical immutability, and classify findings by Tasks 1-6. Reopen the owning task for every Critical or Important finding, apply its documented test-first cycle to the exact files listed there, then repeat full unit/lint/build verification.

- [ ] **Step 6: Confirm protected files are unchanged**

Compare the stored pre-project hashes or current recorded hashes for the three original DOCX files. Expected: all hashes unchanged.

- [ ] **Step 7: Start a production preview**

Run: `npm run preview -- --host 127.0.0.1 --port 4174` after the successful production build. If port 4174 is occupied, use the first free port above it.

Expected: the app loads, default template shows 39 routes, and the user receives the local URL.

- [ ] **Step 8: Record final evidence**

Append test counts, E2E viewport results, review outcome, DOCX hash check, and preview URL to `.superpowers/sdd/progress.md`. Do not claim physical Android/WPS acceptance unless it was actually performed.
