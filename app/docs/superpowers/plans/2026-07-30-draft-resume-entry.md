# Draft Resume Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unfinished inspections immediately recognizable and resumable from the history page.

**Architecture:** Keep the existing `InspectionStatus` and history query unchanged. The history page derives draft records from its loaded graphs, renders them before completed records, and changes only the primary action label and destination for drafts.

**Tech Stack:** React, React Router, Vitest, Testing Library.

## Global Constraints

- A draft must open at `/inspections/:id` without discarding any saved data.
- Reviewed and generated records keep the existing “打开” and “重新生成” actions.
- No new database fields or migrations.

---

### Task 1: Expose Draft Resume Actions

**Files:**
- Modify: `src/features/history/HistoryPage.tsx`
- Modify: `src/features/history/history.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that creates one `draft` and one `generated` graph, then asserts that the draft appears under `待继续巡检`, has `草稿，已自动保存`, and exposes a link named `继续巡检 <title>` to `/inspections/<draft-id>`. Assert the generated record does not expose a `继续巡检` link.

- [ ] **Step 2: Verify RED**

Run: `pnpm test:run src/features/history/history.test.tsx`

Expected: FAIL because the current page only renders one undifferentiated history list and labels its draft action `打开`.

- [ ] **Step 3: Implement the minimal UI change**

Derive `drafts` and `completed` from `visible`. Render drafts in a `section` labelled `待继续巡检` before the completed history list. For a draft row, render status text `草稿，已自动保存` and a link:

```tsx
<Link aria-label={`继续巡检 ${graph.inspection.title}`} to={`/inspections/${graph.inspection.id}`}>
  <Eye aria-hidden="true" size={18} />继续巡检
</Link>
```

Keep the existing completed-record controls unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test:run src/features/history/history.test.tsx`

Expected: all history tests pass, including the new draft-resume test.

- [ ] **Step 5: Verify types and lint**

Run:

```powershell
pnpm exec tsc -b --pretty false
pnpm lint
```

Expected: both commands exit with code 0.
