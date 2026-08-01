# Inspection Item List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact the inspection draft list and make `完成本项` close the current item without automatically opening another one.

**Architecture:** Keep the existing `InspectionEntrySummary` and `InspectionItemSheet` boundaries. The page remains responsible for active-entry state and grouping, while the summary component becomes a single-line opener and the sheet close callback clears the active entry.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, Capacitor Android.

## Global Constraints

- Preserve the existing inspection completion rule: at least one check selection plus at least one photo.
- Preserve the existing `onOpen(entry.id)` callback and accessible button behavior.
- Do not remove compatibility handling for legacy inspection data.
- Do not overwrite unrelated dirty worktree changes.

---

### Task 1: Lock the requested behavior with regression tests

**Files:**
- Modify: `app/src/features/inspections/inspection-flow.test.tsx`
- Modify: `app/src/features/inspections/InspectionEntrySummary.test.tsx`

**Interfaces:**
- Consumes: the current page and summary behavior.
- Produces: failing tests for manual item selection and compact summaries.

- [ ] **Step 1: Change the flow test expectation**

Rename the test to describe closing after completion. After clicking `完成本项`, assert the first dialog is gone and assert no dialog for the second entry is present.

- [ ] **Step 2: Add compact-summary assertions**

Assert the opener still has `data-photo-count` and `data-complete`, contains the item name and `未完成`, and does not render the old `routeName · part` or detail/check-content text.

- [ ] **Step 3: Run the focused tests to verify RED**

Run from `app/`:

```text
pnpm exec vitest run src/features/inspections/inspection-flow.test.tsx src/features/inspections/InspectionEntrySummary.test.tsx --maxWorkers=1
```

Expected: the flow test fails because the current implementation opens the second dialog; the summary test fails because it still renders the old detail content.

### Task 2: Implement manual selection and compact rows

**Files:**
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Modify: `app/src/features/inspections/InspectionEntrySummary.tsx`
- Modify: `app/src/styles/global.css`

**Interfaces:**
- Consumes: the failing tests from Task 1 and existing `InspectionItemSheet` callbacks.
- Produces: a compact route-grouped list and a close-only completion callback.

- [ ] **Step 1: Make completion close the sheet**

Replace the next-entry search in `completeActiveEntry()` with a guard followed by `setActiveEntryId(null)`.

- [ ] **Step 2: Remove the area heading layer**

Flatten each route's area map into its entries before rendering, retaining the route heading and passing each entry to `InspectionEntrySummary`.

- [ ] **Step 3: Reduce the summary component**

Render the existing status indicator, item route/name label, completion text, and chevron in the existing button. Keep the callback, data attributes, and list item structure; remove photo-count, detail, and check-summary output.

- [ ] **Step 4: Adjust CSS for a single-line row**

Use a stable grid with status, flexible label, status text, and chevron. Remove multi-line content/meta rules and reduce row padding while keeping the minimum touch target and visible focus ring.

- [ ] **Step 5: Run the focused tests to verify GREEN**

Run the same focused Vitest command from Task 1 and expect all selected tests to pass.

### Task 3: Run complete verification

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: the tested implementation from Task 2.
- Produces: fresh verification evidence for web and Android artifacts.

- [ ] **Step 1: Run the full test suite**

```text
pnpm exec vitest run --maxWorkers=1
```

- [ ] **Step 2: Run lint and web build**

```text
pnpm lint
pnpm build
```

- [ ] **Step 3: Copy web assets and build Android debug APK**

From `app/`, run `pnpm exec cap copy android`, then from `app/android/` run `gradlew.bat assembleDebug` with JDK 21 and the configured Android SDK.

- [ ] **Step 4: Inspect the diff and report results**

Confirm only the requested source, tests, styles, and planning documents changed, and record any existing unrelated dirty files without reverting them.
