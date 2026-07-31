# Word Body Format Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow “正文字号” to accept“三号” or a numeric point size, add configurable first-line indentation in characters, and generate ordinary Word body paragraphs with the selected formatting.

**Architecture:** Keep `ReportTemplate.bodyFontSizePt` numeric and parse the user-facing text input at the settings boundary. Add `firstLineIndentChars` to the template and report model, normalize legacy templates to 2 characters in the repository/schema boundary, and convert character indentation to DOCX twips only in `generateDocx.ts`.

**Tech Stack:** React 19, TypeScript 6, Dexie, Zod, docx, JSZip, Vitest, Testing Library, Playwright.

## Global Constraints

- Support exactly the Chinese size name“三号”, mapped to 16 points; continue accepting positive numeric point values.
- Default `firstLineIndentChars` to 2 for new and legacy templates.
- Indent opening text, requirement items, inspection evaluation paragraphs, and closing text.
- Do not indent the document title, section headings, organization signature, date, or image-table paragraphs.
- Preserve immutable template versions and existing inspection-to-template-version references.
- Do not add `.docx` uploads, multiple named templates, or deletion/overwrite of template history.
- The workspace is not a Git repository; replace commit steps with recorded test checkpoints and do not initialize Git.

---

### Task 1: Template Field And Legacy Normalization

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/domain/schemas.ts`
- Modify: `src/db/templateRepository.ts`
- Modify: `src/app/dependencies.ts`
- Modify: `src/test/fixtures.ts`
- Test: `src/domain/reportValidation.test.ts`
- Test: `src/db/repositories.test.ts`

**Interfaces:**
- Produces: `ReportTemplate.firstLineIndentChars: number`.
- Produces: `reportTemplateSchema` that fills a missing `firstLineIndentChars` with `2`.
- Produces: `TemplateRepository.get`, `listVersions`, and `getLatest` returning normalized templates.

- [ ] **Step 1: Write failing schema and repository compatibility tests**

Add a schema assertion in `src/domain/reportValidation.test.ts`:

```ts
test("defaults legacy report templates to two first-line indent characters", () => {
  const legacy = { ...makeTemplate() } as Record<string, unknown>;
  delete legacy.firstLineIndentChars;

  const parsed = reportTemplateSchema.parse(legacy);

  expect(parsed.firstLineIndentChars).toBe(2);
});
```

Add a repository assertion in `src/db/repositories.test.ts`:

```ts
test("normalizes a legacy stored report template when it is read", async () => {
  const db = testDb(`legacy-template-indent-${Date.now()}`);
  const legacy = { ...makeTemplate() } as Record<string, unknown>;
  delete legacy.firstLineIndentChars;
  await db.templates.add(legacy as ReportTemplate);

  const restored = await new TemplateRepository(db).get("template-default", 1);

  expect(restored?.firstLineIndentChars).toBe(2);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm test:run src/domain/reportValidation.test.ts src/db/repositories.test.ts
```

Expected: the new tests fail because `firstLineIndentChars` is not defined or normalized.

- [ ] **Step 3: Add the field and normalization**

Add to `ReportTemplate` in `src/domain/models.ts`:

```ts
firstLineIndentChars: number;
```

Add to `reportTemplateSchema` in `src/domain/schemas.ts`:

```ts
firstLineIndentChars: z.number().finite().nonnegative().default(2),
```

Normalize repository reads in `src/db/templateRepository.ts`:

```ts
import { reportTemplateSchema } from "../domain/schemas";

function normalizeTemplate(template: ReportTemplate): ReportTemplate {
  return reportTemplateSchema.parse(template);
}

async get(id: string, version: number): Promise<ReportTemplate | undefined> {
  const template = await this.db.templates.get([id, version]);
  return template ? normalizeTemplate(template) : undefined;
}

async listVersions(id: string): Promise<ReportTemplate[]> {
  const templates = await this.db.templates.where("id").equals(id).toArray();
  return templates
    .map(normalizeTemplate)
    .sort((left, right) => right.version - left.version);
}
```

Set `firstLineIndentChars: 2` in both default templates in `src/app/dependencies.ts` and in `makeTemplate()` in `src/test/fixtures.ts`. Ensure the formal template copies the field explicitly when it is derived from the default template.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
pnpm test:run src/domain/reportValidation.test.ts src/db/repositories.test.ts src/app/dependencies.test.ts src/db/backupRepository.test.ts
```

Expected: all selected tests pass and legacy template imports/readbacks produce `firstLineIndentChars: 2`.

- [ ] **Step 5: Record checkpoint**

Record that Task 1 focused tests passed. Do not run Git commands because this workspace has no repository.

---

### Task 2: Template Settings Inputs And Validation

**Files:**
- Create: `src/features/settings/reportTemplateInputs.ts`
- Create: `src/features/settings/reportTemplateInputs.test.ts`
- Modify: `src/features/settings/TemplateSettingsPage.tsx`
- Modify: `src/features/settings/template-settings.test.tsx`
- Modify: `tests/e2e/word-export.spec.ts`

**Interfaces:**
- Produces: `parseBodyFontSizeInput(value: string): number | null`.
- Produces: `parseFirstLineIndentInput(value: string): number | null`.
- Consumes: `ReportTemplate.firstLineIndentChars` from Task 1.

- [ ] **Step 1: Write failing input-parser tests**

Create `src/features/settings/reportTemplateInputs.test.ts`:

```ts
import { parseBodyFontSizeInput, parseFirstLineIndentInput } from "./reportTemplateInputs";

test.each([
  ["三号", 16],
  [" 三号 ", 16],
  ["16", 16],
  ["12.5", 12.5],
])("parses body font size %s", (input, expected) => {
  expect(parseBodyFontSizeInput(input)).toBe(expected);
});

test.each(["", "四号", "0", "-1", "abc"])("rejects invalid body font size %s", (input) => {
  expect(parseBodyFontSizeInput(input)).toBeNull();
});

test.each([
  ["0", 0],
  ["2", 2],
  ["2.5", 2.5],
])("parses first-line indent %s", (input, expected) => {
  expect(parseFirstLineIndentInput(input)).toBe(expected);
});

test.each(["", "-1", "abc"])("rejects invalid first-line indent %s", (input) => {
  expect(parseFirstLineIndentInput(input)).toBeNull();
});
```

Extend `src/features/settings/template-settings.test.tsx` so the save test clears “正文字号”, types“三号”, fills “正文首行缩进” with `2`, saves, and asserts:

```ts
expect((await templates.getLatest("template-default"))?.bodyFontSizePt).toBe(16);
expect((await templates.getLatest("template-default"))?.firstLineIndentChars).toBe(2);
```

Add one UI test that enters“四号” and confirms the alert text is“正文字号请输入三号或大于0的磅值” and no new version is created.

At the start of the Word export E2E flow in `tests/e2e/word-export.spec.ts`, navigate to `/#/settings/templates`, fill “正文字号” with“三号”, fill “正文首行缩进” with `2`, save the new version, and assert the next-version indicator advances. Then create the inspection and continue the existing export flow.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm test:run src/features/settings/reportTemplateInputs.test.ts src/features/settings/template-settings.test.tsx
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm exec playwright test tests/e2e/word-export.spec.ts
```

Expected: parser tests fail and the browser flow cannot find or use the new indentation control.

- [ ] **Step 3: Implement parsers and settings state**

Create `src/features/settings/reportTemplateInputs.ts`:

```ts
function parseNonnegativeDecimal(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:\d+|\d+\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBodyFontSizeInput(value: string): number | null {
  if (value.trim() === "三号") return 16;
  const parsed = parseNonnegativeDecimal(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function parseFirstLineIndentInput(value: string): number | null {
  return parseNonnegativeDecimal(value);
}
```

In `TemplateSettingsPage.tsx`, keep the two editable strings separate from the numeric `draft`:

```ts
const [bodyFontSizeInput, setBodyFontSizeInput] = useState("");
const [firstLineIndentInput, setFirstLineIndentInput] = useState("2");
```

When the template loads, initialize those values from `template.bodyFontSizePt` and `template.firstLineIndentChars`. Before schema validation in `save()`, parse both values; show the exact design error messages and return when either parser returns `null`. Build `candidate` with the parsed numeric values.

Replace the existing numeric字号 input and add the indentation input:

```tsx
<label>
  正文字号
  <input
    aria-label="正文字号"
    inputMode="decimal"
    value={bodyFontSizeInput}
    onChange={(event) => setBodyFontSizeInput(event.currentTarget.value)}
  />
</label>
<label>
  正文首行缩进（字符）
  <input
    aria-label="正文首行缩进"
    inputMode="decimal"
    value={firstLineIndentInput}
    onChange={(event) => setFirstLineIndentInput(event.currentTarget.value)}
  />
</label>
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
pnpm test:run src/features/settings/reportTemplateInputs.test.ts src/features/settings/template-settings.test.tsx
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm exec playwright test tests/e2e/word-export.spec.ts
```

Expected: parser, settings, and both mobile Word export flows pass; saved templates contain numeric `16` and `2`.

- [ ] **Step 5: Record checkpoint**

Record that Task 2 focused tests passed. Do not run Git commands.

---

### Task 3: Report Model And DOCX Paragraph Formatting

**Files:**
- Modify: `src/features/reports/reportModel.ts`
- Modify: `src/features/reports/reportModel.test.ts`
- Modify: `src/features/reports/generateDocx.ts`
- Modify: `src/features/reports/generateDocx.test.ts`
- Modify: `tests/e2e/word-export.spec.ts`

**Interfaces:**
- Consumes: `ReportTemplate.firstLineIndentChars` from Task 1.
- Produces: `ReportModel.firstLineIndentChars: number`.
- Produces: ordinary body paragraphs with `w:sz="32"` and `w:firstLine="640"` for 三号/2字符.

- [ ] **Step 1: Write failing report-model and DOCX XML tests**

In `src/features/reports/reportModel.test.ts`, build a template with `firstLineIndentChars: 3` and assert:

```ts
expect(model.firstLineIndentChars).toBe(3);
```

In `src/features/reports/generateDocx.test.ts`, add a helper:

```ts
function paragraphContaining(documentXml: string, text: string): string {
  const paragraph = [...documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
    .map((match) => match[0])
    .find((value) => value.includes(text));
  if (!paragraph) throw new Error(`Paragraph not found: ${text}`);
  return paragraph;
}
```

Generate a model with `bodyFontSizePt: 16` and `firstLineIndentChars: 2`. Assert the opening, one requirement, one evaluation, and closing paragraphs each contain:

```ts
expect(paragraph).toContain('<w:sz w:val="32"/>');
expect(paragraph).toContain('<w:ind w:firstLine="640"/>');
```

Assert general heading, situation heading, photo section heading, organization name, and signature date do not contain `w:firstLine`.

Extend the existing downloaded-DOCX XML assertions in `tests/e2e/word-export.spec.ts`:

```ts
expect(documentXml).toContain('<w:sz w:val="32"/>');
expect(documentXml).toContain('<w:ind w:firstLine="640"/>');
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm test:run src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm exec playwright test tests/e2e/word-export.spec.ts
```

Expected: `ReportModel` lacks the new field and unit/E2E DOCX XML assertions cannot find `w:firstLine="640"`.

- [ ] **Step 3: Carry indentation through the report model**

Add to `ReportModel` in `reportModel.ts`:

```ts
firstLineIndentChars: number;
```

Add to the returned model:

```ts
firstLineIndentChars: template.firstLineIndentChars,
```

- [ ] **Step 4: Apply indentation only to ordinary body paragraphs**

Extend `bodyParagraph` options in `generateDocx.ts` with `firstLineIndent?: boolean`, and add:

```ts
indent: options.firstLineIndent
  ? { firstLine: Math.round(model.bodyFontSizePt * model.firstLineIndentChars * 20) }
  : undefined,
```

Pass `{ firstLineIndent: true }` for `model.openingText`, each requirement, each photo-group evaluation paragraph, and `model.closingText`. Do not pass it for any heading, organization name, date, title, or image-table paragraph.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
pnpm test:run src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts src/features/reports/reportGenerationService.test.ts
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm exec playwright test tests/e2e/word-export.spec.ts
```

Expected: all selected report tests pass and XML assertions distinguish indented body paragraphs from non-indented headings/signatures.

- [ ] **Step 6: Record checkpoint**

Record that Task 3 focused tests passed. Do not run Git commands.

---

### Task 4: Browser Regression And Final Verification

**Files:**
- Verify: generated `.docx` package and existing application flows

**Interfaces:**
- Consumes: settings controls and generated DOCX behavior from Tasks 1-3.
- Produces: end-to-end coverage for saving“三号” and 2-character indentation before Word export.

- [ ] **Step 1: Re-run the focused E2E from Tasks 2-3**

Run:

```powershell
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm exec playwright test tests/e2e/word-export.spec.ts
```

Expected: both mobile projects pass, including saving“三号”, saving 2-character indentation, and inspecting the downloaded DOCX XML.

- [ ] **Step 2: Run complete verification**

Run:

```powershell
pnpm exec tsc -b --pretty false
pnpm lint
pnpm test:run
pnpm build
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e
```

Expected:

- TypeScript exits 0.
- Lint exits 0.
- All Vitest files and tests pass.
- Vite production build exits 0.
- All Playwright tests pass in both 360×800 and 412×915 mobile projects.

- [ ] **Step 3: Check DOCX rendering capability**

Run:

```powershell
Get-Command soffice -ErrorAction SilentlyContinue
Get-Command pdftoppm -ErrorAction SilentlyContinue
```

If both commands exist, generate a sample DOCX, render it to pages, and visually inspect each page for indentation and layout. If unavailable, verify `word/document.xml`, image relationships, and JPEG headers, then explicitly report that page rendering could not be performed locally.

- [ ] **Step 4: Refresh the existing preview**

Confirm `http://127.0.0.1:4175/#/settings/templates` serves the latest build. Reload once to update the PWA cache and verify the two controls are visible without horizontal overflow.

- [ ] **Step 5: Record final checkpoint**

Record exact test counts, viewport coverage, build result, and DOCX rendering availability. Do not run Git commands.
