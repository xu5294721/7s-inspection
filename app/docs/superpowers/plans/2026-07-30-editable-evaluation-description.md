# Editable Evaluation Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to edit the generated evaluation description and export the final saved text to Word.

**Architecture:** Keep manual text in the existing `PhotoGroup.description` field and add an optional `descriptionManuallyEdited` flag. Inspection, review, and report code use that explicit flag to choose automatic check-content text or a saved manual description.

**Tech Stack:** React, TypeScript, Vitest, Dexie, docx.

## Global Constraints

- Do not add data tables; use the optional `PhotoGroup.descriptionManuallyEdited` field for backward-compatible state.
- A manual description takes precedence over automatic check-content text.
- Existing groups that still contain their category preset keep automatic check-content behavior.
- Empty evaluation descriptions remain invalid when saving a group.

---

### Task 1: Centralize Description Priority

**Files:**
- Modify: `src/domain/inspection.ts`
- Modify: `src/features/reports/reportModel.ts`
- Modify: `src/features/review/ReviewGroupList.tsx`
- Test: `src/features/reports/reportModel.test.ts`

**Interfaces:**
- Produces: `PhotoGroup.descriptionManuallyEdited?: boolean`.
- Consumes: `formatInspectionEvaluationDescription(routeName, selections)`.

- [ ] **Step 1: Write a failing report-model test**

```ts
expect(model.sections[0]?.groups[0]?.text).toBe("卷扬机间：环境卫生干净整洁，补充：地沟已清理。");
```

Create an entry with an environment selection, then assign its photo group a description different from that category's default description.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/features/reports/reportModel.test.ts`

Expected: FAIL because the report currently always chooses selected check-content text.

- [ ] **Step 3: Add the explicit manual-edit marker and use it**

```ts
interface PhotoGroup {
  descriptionManuallyEdited?: boolean;
}
```

In report and review display, use `group.description` only when `descriptionManuallyEdited` is true; otherwise use automatic check-content text when present.

- [ ] **Step 4: Run the report test to verify it passes**

Run: `pnpm test:run src/features/reports/reportModel.test.ts`

Expected: PASS.

### Task 2: Enable Manual Editing From Automatic Text

**Files:**
- Modify: `src/features/photos/PhotoGroupEditor.tsx`
- Modify: `src/features/inspections/InspectionEntryEditor.tsx`
- Test: `src/features/inspections/group-evaluation.test.tsx`

**Interfaces:**
- Consumes: `usesPresetDescription` and current automatic description from `formatInspectionEvaluationDescription`.
- Produces: a writable `评价说明` textarea whose first user edit saves the current automatic text plus the user's edit.

- [ ] **Step 1: Write a failing inspection-page test**

```ts
await user.type(within(editor).getByRole("textbox", { name: "评价说明" }), "，补充：地沟已清理。");
await user.click(within(editor).getByRole("button", { name: "保存评价" }));
expect(stored?.groups[0]?.description).toBe("卷扬机间：环境卫生干净整洁，补充：地沟已清理。");
```

Use an entry with confirmed check-content selections and a photo group with the standard category description.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/features/inspections/group-evaluation.test.tsx`

Expected: FAIL because the description textarea is read-only while an automatic override exists.

- [ ] **Step 3: Implement a local editable initial value**

When the displayed automatic text is first edited, copy that text into `draft.description`, mark it as edited, then apply the typed value. Remove the read-only state for the textarea. Keep category changes resetting descriptions only while the group still uses a preset description.

- [ ] **Step 4: Run the inspection-page test to verify it passes**

Run: `pnpm test:run src/features/inspections/group-evaluation.test.tsx`

Expected: PASS.

### Task 3: Verify Integrated Export Behavior

**Files:**
- Test: `src/features/review/ReviewPage.test.tsx`
- Test: `src/features/reports/generateDocx.test.ts`

- [ ] **Step 1: Add integration assertions**

```ts
expect(screen.getByText("卷扬机间：环境卫生干净整洁，补充：地沟已清理。")).toBeInTheDocument();
expect(documentXml).toContain("卷扬机间：环境卫生干净整洁，补充：地沟已清理。");
```

- [ ] **Step 2: Run targeted suites**

Run: `pnpm test:run src/features/inspections/group-evaluation.test.tsx src/features/review/ReviewPage.test.tsx src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts`

Expected: PASS.

- [ ] **Step 3: Run static and production verification**

Run: `pnpm exec tsc -b --pretty false`

Run: `pnpm lint`

Run: `pnpm build`

Expected: all commands exit 0.
