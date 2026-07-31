# Word Conditional Headings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Omit empty Word report categories, honor explicitly cleared template headings, and apply configured first-line indentation to the situation and non-empty category headings.

**Architecture:** Preserve the distinction between a legacy missing heading (`undefined`) and a user-cleared heading (`""`) at the template boundary. Filter empty categories in the report model, then let the DOCX generator conditionally emit heading paragraphs with the existing body indentation calculation.

**Tech Stack:** TypeScript 6, React 19, Zod 4, docx 9, Vitest 4, JSZip.

## Completion Record

Completed 2026-07-30.

- Focused verification: 46 unit tests and 2 mobile Word-export E2E tests passed.
- Full verification: TypeScript and lint passed; 490 unit tests and 14 mobile E2E tests passed.
- Independent implementation review found no production-code defects. A follow-up E2E review identified configurable-heading assumptions; the test now reads template values, verifies a cleared general heading is absent, and verifies a customized situation heading is indented. Follow-up review approved.
- LibreOffice is not installed on this computer, so Word verification covers exported DOCX XML, media relationships, and browser export behavior rather than rendered-page appearance.

## Global Constraints

- Explicit empty `generalHeading` or `situationHeading` means omit the paragraph.
- Missing legacy `generalHeading` or `situationHeading` keeps the existing compatibility default.
- Category sections with no photographed groups are absent from `ReportModel.sections`.
- Situation and category headings use `firstLineIndentChars`; retained general heading does not.
- Existing evaluation paragraphs remain indented; title, signature, date, and image paragraphs remain unindented.
- Do not change section text/order, numbering text, Word annex behavior, existing templates, inspections, or photos.
- This directory is not a Git repository; each task ends with tests and an independent review checkpoint.

---

### Task 1: Preserve Explicitly Cleared Template Headings

**Files:**
- Modify: `src/domain/schemas.ts`
- Modify: `src/features/settings/TemplateSettingsPage.tsx`
- Modify: `src/features/settings/template-settings.test.tsx`
- Modify: `src/domain/reportValidation.test.ts`

**Interfaces:**
- `reportTemplateSchema` accepts `""` for `generalHeading` and `situationHeading` while retaining optional legacy fields.
- Template settings save an empty input as `""`, not `undefined`.

- [ ] **Step 1: Write failing schema and settings tests**

Add a schema test that parses `{ ...makeTemplate(), generalHeading: "", situationHeading: "" }` successfully and returns both empty strings. Add a settings-page test that clears “总体要求标题” and “总体情况标题”, saves a new version, then asserts the latest template stores both fields as `""`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm test:run src/domain/reportValidation.test.ts src/features/settings/template-settings.test.tsx
```

Expected: schema rejects empty headings and/or the settings page stores `undefined`.

- [ ] **Step 3: Implement minimal empty-string semantics**

Change both heading schemas from `z.string().trim().min(1).optional()` to `z.string().trim().optional()`. In `TemplateSettingsPage`, pass `event.currentTarget.value` directly to `set("generalHeading", ...)` and `set("situationHeading", ...)` instead of converting an empty string to `undefined`.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2. Expected: all focused tests pass.

Review checkpoint: confirm legacy missing fields remain valid and only the two optional heading fields accept empty strings.

---

### Task 2: Filter Empty Categories And Keep Legacy Defaults

**Files:**
- Modify: `src/features/reports/reportModel.ts`
- Modify: `src/features/reports/reportModel.test.ts`

**Interfaces:**
- `buildReportModel` returns only category sections whose `groups.length > 0`.
- Missing headings receive compatibility defaults; explicit empty headings stay empty.

- [ ] **Step 1: Write failing report-model tests**

Create one graph with only a photographed good group and assert `model.sections.map(section => section.category)` equals `["good"]`. Create another graph with a template whose two headings are empty and assert both model fields are empty. Delete both heading properties from a legacy template object and assert the model uses `一、“7S”巡检工作总体要求` and `二、本次检查总体情况`.

- [ ] **Step 2: Verify RED**

Run: `pnpm test:run src/features/reports/reportModel.test.ts`

Expected: empty reminder/assessment sections remain and/or explicit empty headings are incorrectly replaced.

- [ ] **Step 3: Implement minimal model filtering**

Keep nullish fallback (`??`) for legacy missing headings so empty strings are preserved. Append `.filter((section) => section.groups.length > 0)` to the ordered section construction after each section's groups are built.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2. Expected: every report-model test passes.

Review checkpoint: confirm photographed-group ordering and numbering remain category-local and unchanged.

---

### Task 3: Conditionally Emit And Indent DOCX Headings

**Files:**
- Modify: `src/features/reports/generateDocx.ts`
- Modify: `src/features/reports/generateDocx.test.ts`
- Modify: `tests/e2e/word-export.spec.ts`

**Interfaces:**
- DOCX children include a heading only when its trimmed text is non-empty.
- Situation and category title paragraphs pass `firstLineIndent: true`.

- [ ] **Step 1: Write failing DOCX XML tests**

Add a test using `bodyFontSizePt: 16` and `firstLineIndentChars: 2` that asserts the situation heading and the sole non-empty good-category title both contain `<w:ind w:firstLine="640"/>`. Assert reminder and assessment titles are absent when those categories have no groups. Add a template with `generalHeading: ""` and assert the compatibility title is absent while requirement paragraphs remain. Add `situationHeading: ""` and assert no empty heading paragraph is emitted.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm test:run src/features/reports/generateDocx.test.ts
```

Expected: empty section titles are present, the cleared general heading is replaced or emitted, and situation/category headings lack `w:firstLine`.

- [ ] **Step 3: Implement conditional paragraph assembly**

Build `children` in stages rather than an array containing unconditional headings:

```ts
const children: Array<Paragraph | Table> = [titleParagraph, openingParagraph];
if (model.generalHeading.trim()) {
  children.push(bodyParagraph(model, model.generalHeading, { bold: true, heading: true }));
}
children.push(...requirementParagraphs);
if (model.situationHeading.trim()) {
  children.push(bodyParagraph(model, model.situationHeading, {
    bold: true,
    heading: true,
    firstLineIndent: true,
  }));
}
```

For every remaining `model.sections` entry, emit its title with `{ bold: true, heading: true, firstLineIndent: true }`. Do not add a second generator-side category filter; rely on the report-model invariant and retain defensive non-empty heading checks only for heading text.

- [ ] **Step 4: Update mobile Word E2E assertions**

In `word-export.spec.ts`, generate a report containing only one category and assert the downloaded DOCX XML contains only that category title, excludes the other two titles, excludes the cleared overall-requirements heading, and contains indentation values for situation/category paragraphs.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
pnpm test:run src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts src/features/settings/template-settings.test.tsx
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm exec playwright test tests/e2e/word-export.spec.ts
```

Expected: focused unit and both mobile Word E2E projects pass.

Review checkpoint: inspect the XML assertions for real paragraph text, indentation, absence of empty categories, and unchanged image relationships.

---

### Task 4: Full Verification And APK Plan Handoff

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Modify: `docs/superpowers/plans/2026-07-30-android-apk.md`

- [ ] **Step 1: Run fresh full verification**

Run sequentially:

```powershell
pnpm exec tsc -b --pretty false
pnpm lint
pnpm test:run
pnpm build
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e
```

Expected: zero TypeScript/lint errors, all Vitest files pass, production build exits zero, and all 14 mobile E2E tests pass.

- [ ] **Step 2: Request independent final review**

Give the reviewer the confirmed design, this plan, changed files, and complete verification output. Fix every Critical or Important finding with a new failing test, then repeat affected and full verification.

- [ ] **Step 3: Record the prerequisite in the APK plan**

Mark this Word behavior as an already-completed prerequisite in the APK plan so Android packaging preserves the corrected generator rather than reimplementing it.

- [ ] **Step 4: Record completion**

Update `.superpowers/sdd/progress.md` with focused and full test counts. State the LibreOffice visual-rendering gap if LibreOffice remains unavailable; do not claim rendered-page inspection from XML tests alone.
