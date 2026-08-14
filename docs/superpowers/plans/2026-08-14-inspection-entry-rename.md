# Current Inspection Item Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe rename action for an inspection entry that changes only the current inspection snapshot.

**Architecture:** Add an atomic `InspectionRepository.renameInspectionEntry` operation and expose it through `InspectionRepositoryPort`. The operation updates the target snapshot plus any current-inspection route-order references, while the inspection page owns async lifecycle and graph refresh and `InspectionItemSheet` owns the rename dialog state and focus behavior. The checklist library and route-template tables remain untouched.

**Tech Stack:** React 19, TypeScript, Dexie, Vitest, Testing Library, Lucide icons.

## Global Constraints

- Use `C:\Users\xj\Desktop\7s管理\.worktrees\git-canonical` as `PROJECT_ROOT`.
- Do not modify the root `main` worktree or the existing `.superpowers/sdd/task-1-report.md` change.
- Preserve the current inspection entry `itemId`, snapshot fields other than `routeName`, selections, groups, photos, and order.
- Do not write to `checklistItems` or `routeTemplates`.
- Normalize the new name with `normalizeRouteName`; reject empty and duplicate names within the same inspection.
- Replace the old name with the new name in `reviewRouteOrder` and every defined `reviewRouteOrderByCategory` array in the same inspection.
- Reset the inspection status to `draft` and update `updatedAt` after a successful rename.

---

### Task 1: Add the repository rename contract and regression tests

**Files:**
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/db/inspectionRepository.ts`
- Test: `app/src/db/repositories.test.ts`

**Interfaces:**
- Add `renameInspectionEntry(inspectionId: string, entryId: string, name: string, updatedAt?: string): Promise<InspectionEntryRenameResult>` to `InspectionRepositoryPort`.
- Export and implement the same `InspectionEntryRenameResult` signature on `InspectionRepository`.

- [ ] **Step 1: Write the failing repository test**

Add a test that creates one inspection entry with selections and a photo group, sets `reviewRouteOrder` and `reviewRouteOrderByCategory`, calls `renameInspectionEntry`, and asserts the returned/stored entry has the new normalized name, the inspection is `draft`, both route-order fields contain the new name, and all non-name fields are unchanged. Assert the checklist item and route template names remain unchanged.

The core assertion should have this shape:

```ts
const before = await repository.getGraph("inspection-1");
const result = await repository.renameInspectionEntry("inspection-1", "entry-1", "  新名称  ", fixedTime);
const after = await repository.getGraph("inspection-1");
expect(result.entry.itemSnapshot.routeName).toBe("新名称");
expect(after?.inspection.status).toBe("draft");
expect(after?.inspection.reviewRouteOrder).toEqual(["新名称"]);
expect(after?.inspection.reviewRouteOrderByCategory?.good).toEqual(["新名称"]);
expect(after?.groups).toEqual(before?.groups);
expect(after?.photos).toEqual(before?.photos);
```

Add separate tests for empty names, duplicate names in the same inspection, an entry from another inspection, and a missing entry. Each must reject with the expected `GraphIntegrityError` message and leave the database unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `PROJECT_ROOT/app`:

```text
pnpm exec vitest run src/db/repositories.test.ts --maxWorkers=1 --reporter=verbose
```

Expected: the new rename tests fail because the repository method and dependency contract do not exist yet; unrelated existing tests remain green.

- [ ] **Step 3: Implement the minimal repository operation**

Add the port mapping in `app/src/app/dependencies.ts`. Use this result contract:

```ts
export interface InspectionEntryRenameResult {
  entry: InspectionEntry;
  updatedAt: string;
  reviewRouteOrder?: string[];
  reviewRouteOrderByCategory?: ReviewRouteOrderByCategory;
}
```

In `InspectionRepository`, use a Dexie read/write transaction over `inspections` and `entries`, verify ownership, normalize and validate the name, reject duplicates except for the target entry, replace the old name in both route-order fields, update only the target snapshot name plus those current-inspection references, set inspection `status: "draft"` and `updatedAt`, then return the result contract.

- [ ] **Step 4: Run the repository tests and verify GREEN**

Run the same focused Vitest command. Expected: all repository tests, including the rename regressions, pass.

- [ ] **Step 5: Commit the repository contract**

```text
git add app/src/app/dependencies.ts app/src/db/inspectionRepository.ts app/src/db/repositories.test.ts
git commit -m "feat: rename current inspection entries"
```

### Task 2: Add the current-inspection rename dialog and page wiring

**Files:**
- Modify: `app/src/features/inspections/CustomRouteDialog.tsx`
- Modify: `app/src/features/inspections/InspectionItemSheet.tsx`
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Test: `app/src/features/inspections/inspection-flow.test.tsx`

**Interfaces:**
- Extend `CustomRouteDialog` with optional `initialName?: string` and use it as the initial controlled input value.
- Add `onRename(name: string): Promise<void>` to `InspectionItemSheetProps`.

- [ ] **Step 1: Write the failing UI tests**

Add a flow test that opens an existing current inspection entry, clicks `修改检查项名称`, verifies the input is prefilled, changes it, saves, and asserts the list and persisted entry use the new name while the original check selections, photo group IDs, item ID, checklist item, and route template remain unchanged.

The UI interaction should have this shape:

```ts
await user.click(within(sheet).getByRole("button", { name: "修改检查项名称" }));
const renameDialog = screen.getByRole("dialog", { name: "修改本次检查项名称" });
expect(within(renameDialog).getByRole("textbox", { name: "检查项名称" })).toHaveValue("原名称");
await user.clear(within(renameDialog).getByRole("textbox", { name: "检查项名称" }));
await user.type(within(renameDialog).getByRole("textbox", { name: "检查项名称" }), "更正名称");
await user.click(within(renameDialog).getByRole("button", { name: "保存" }));
expect(await screen.findByRole("button", { name: /更正名称/ })).toBeVisible();
```

Add tests that duplicate or empty names keep the rename dialog open with an alert, a rejected save retains the input and focus, and double submission invokes the repository once.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run from `PROJECT_ROOT/app`:

```text
pnpm exec vitest run src/features/inspections/inspection-flow.test.tsx --maxWorkers=1 --reporter=verbose
```

Expected: the new test fails because the rename button and callback are not present.

- [ ] **Step 3: Implement the minimal UI and page update**

Generalize `CustomRouteDialog` to accept `initialName`, add the pencil icon button and rename dialog to `InspectionItemSheet`, and pass an `onRename` handler from `InspectionPage`. The handler must use the existing `savingEntryIds` and inspection-generation guards, call the repository operation, replace the target entry in the graph, and close the rename dialog only after success.

- [ ] **Step 4: Run the focused UI test and verify GREEN**

Run the same focused UI command. Expected: all inspection-flow tests pass, including the new rename behavior and existing cancel/add-entry regressions.

- [ ] **Step 5: Commit the UI behavior**

```text
git add app/src/features/inspections/CustomRouteDialog.tsx app/src/features/inspections/InspectionItemSheet.tsx app/src/features/inspections/InspectionPage.tsx app/src/features/inspections/inspection-flow.test.tsx
git commit -m "feat: add current inspection item rename dialog"
```

### Task 3: Full verification and handoff

**Files:**
- No additional production files.

- [ ] **Step 1: Run the focused repository and UI tests**

```text
pnpm exec vitest run src/db/repositories.test.ts src/features/inspections/inspection-flow.test.tsx --maxWorkers=1 --reporter=dot
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 2: Run lint and production build**

```text
pnpm lint
pnpm build
```

Expected: both commands exit 0; any existing large-chunk warning may remain.

- [ ] **Step 3: Inspect the final diff and worktree boundary**

```powershell
$env:GIT_OPTIONAL_LOCKS='0'; git diff --check
$env:GIT_OPTIONAL_LOCKS='0'; git status --short --branch
```

Confirm only the two feature commits and the pre-existing `.superpowers/sdd/task-1-report.md` change are present; do not stage or reset the report.
