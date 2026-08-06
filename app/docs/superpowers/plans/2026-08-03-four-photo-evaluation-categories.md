# Four Photo Evaluation Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add the formal 一般表现 photo category across inspection data, review, templates, Word generation, backups, and Android packaging while preserving legacy three-category records and templates.

**Architecture:** Add one shared category catalog with internal IDs good, general, reminder, and assessment. Keep category-specific default text in checklist item snapshots, with a deterministic fallback for legacy items that lack generalText. Keep historical three-section report templates valid, seed a new four-section formal template version, and block Word generation when a legacy template is used with a category it cannot display.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Dexie 4, Zod 4, ExcelJS 4, docx 9.7.1, Capacitor Android 8.4.2, pnpm, Python extraction tests.

## Global Constraints

- The user-visible category name is 一般表现; 做的一般 and the voice-transcription phrase 作弊班 are not UI or Word labels.
- The default order is 好的方面, 一般表现, 提醒问题, 考核问题.
- 一般表现 uses independent text such as {检查部位}7S管理基本落实，但现场标准仍有提升空间。 and never reuses reminder text.
- 一般表现 and 提醒问题 cannot contain reward or assessment data; 好的方面 keeps optional reward data; 考核问题 keeps required personnel and positive amount data.
- Historical three-category templates and records remain readable; historical template versions are never rewritten.
- Existing fixed 3:4 Word photo frames, Word-only compression, original photos, thumbnails, gallery backup, and preview behavior remain unchanged.
- Do not add scoring levels, rectification workflow, accounts, cloud services, or new award types.
- Do not push or publish a GitHub release as part of this implementation; build and verify a local APK only unless the user separately requests release publication.
- Work from C:/Users/xj/Desktop/7s管理/app for pnpm and Python commands unless a task explicitly says otherwise.

## File Map

- Create app/src/domain/photoCategory.ts for shared category IDs, labels, and order.
- Modify app/src/domain/models.ts, app/src/domain/schemas.ts, app/src/domain/inspection.ts, app/src/domain/customChecklistItem.ts, app/src/data/core-inspection-items.ts, and app/src/test/fixtures.ts for category and checklist text behavior.
- Modify app/src/features/items/excelImport.ts, app/src/features/items/ItemEditor.tsx, app/scripts/extract-default-items.py, app/scripts/test_extract_default_items.py, and app/scripts/generate-checklist-import-template.mjs; regenerate app/src/data/default-checklist-items.json and app/public/fixtures/checklist-import-template.xlsx.
- Modify app/src/db/inspectionRepository.ts, app/src/domain/reportValidation.ts, app/src/domain/reviewRouteOrder.ts, app/src/features/review/reviewSummary.ts, and backup-related tests for persistence and validation.
- Modify app/src/app/dependencies.ts, app/src/features/settings/TemplateSettingsPage.tsx, and related tests for the new formal template version.
- Modify app/src/features/photos/PhotoGroupEditor.tsx, app/src/features/review/ReviewPage.tsx, app/src/features/review/ReviewRouteSortDialog.tsx, app/src/styles/global.css, and related tests for the review UI.
- Extend app/src/features/reports/reportModel.test.ts, app/src/features/reports/generateDocx.test.ts, app/tests/e2e/inspection-flow.spec.ts, and app/tests/e2e/word-export.spec.ts for report behavior; do not change generateDocx.ts unless a failing test proves a category-specific generator change is required.
- Modify app/android/app/build.gradle only in the delivery task to increment the local APK version from 1.0.3/versionCode 4 to 1.0.4/versionCode 5.

---

### Task 1: Add Category Catalog And Independent Checklist Text

**Files:**
- Create: app/src/domain/photoCategory.ts
- Modify: app/src/domain/models.ts
- Modify: app/src/domain/schemas.ts
- Modify: app/src/domain/inspection.ts
- Modify: app/src/domain/customChecklistItem.ts
- Modify: app/src/data/core-inspection-items.ts
- Modify: app/src/test/fixtures.ts
- Modify: app/src/features/items/excelImport.ts
- Modify: app/src/features/items/ItemEditor.tsx
- Modify: app/scripts/extract-default-items.py
- Modify: app/scripts/test_extract_default_items.py
- Modify: app/scripts/generate-checklist-import-template.mjs
- Regenerate: app/src/data/default-checklist-items.json and app/public/fixtures/checklist-import-template.xlsx
- Test: app/src/domain/inspection.test.ts and app/src/features/items/excelImport.test.ts

**Interfaces:**
- PHOTO_CATEGORIES exposes { id: PhotoCategory; label: string }[] in the order good, general, reminder, assessment.
- photoCategoryLabel(category: PhotoCategory): string returns the user-visible label.
- defaultGeneralText(item: Pick<ChecklistItem, "routeName" | "part">): string returns the deterministic fallback sentence.
- descriptionForCategory(item, "general") returns trimmed item.generalText when present and the fallback otherwise.

- [ ] Step 1: Write the failing domain test.

Add this test to app/src/domain/inspection.test.ts:

~~~ts
test("uses independent general-performance text and a legacy fallback", () => {
  const item = makeChecklistItem({
    generalText: "油缸表面基本清洁，但标准化保养仍有提升空间。",
  });

  expect(descriptionForCategory(item, "general")).toBe(
    "油缸表面基本清洁，但标准化保养仍有提升空间。",
  );
  expect(descriptionForCategory({ ...item, generalText: undefined }, "general")).toBe(
    "油缸7S管理基本落实，但现场标准仍有提升空间。",
  );
});
~~~

Add a second test asserting changePhotoGroupCategory(group, "general", item) clears an existing reward or assessment object and uses the general text. Update makeChecklistItem with generalText so the fixture documents the new field.

- [ ] Step 2: Run the focused test and verify the red failure.

Run:

~~~powershell
pnpm exec vitest run src/domain/inspection.test.ts
~~~

Expected: FAIL because general is not yet a valid PhotoCategory and the independent text branch does not exist. Fix only test setup errors that prevent the intended feature failure.

- [ ] Step 3: Implement the category catalog and fallback.

Create app/src/domain/photoCategory.ts:

~~~ts
import type { PhotoCategory } from "./models";

export const PHOTO_CATEGORIES = [
  { id: "good", label: "好的方面" },
  { id: "general", label: "一般表现" },
  { id: "reminder", label: "提醒问题" },
  { id: "assessment", label: "考核问题" },
] as const satisfies readonly { id: PhotoCategory; label: string }[];

export function photoCategoryLabel(category: PhotoCategory): string {
  return PHOTO_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}
~~~

Extend PhotoCategory and add optional legacy-compatible generalText?: string to ChecklistItem. Let checklistItemSchema and itemSnapshotSchema accept an absent generalText. In inspection.ts, add defaultGeneralText and handle general before the reminder and assessment branches. Add generalText to core and custom item constructors and to the fixture.

- [ ] Step 4: Run the focused test and verify green.

Run:

~~~powershell
pnpm exec vitest run src/domain/inspection.test.ts
~~~

Expected: all inspection tests pass, including the independent general-text and award-clearing assertions.

- [ ] Step 5: Update default data and item editing/import contracts.

Add 一般表现表述 after 好的表述 to EXCEL_HEADERS, REQUIRED_TEXT_FIELDS, and COMPARABLE_FIELDS. Parse the new column into generalText; when a legacy workbook has the old 13-column header set or the new field is blank, use defaultGeneralText after parsing. Keep the old header set accepted so existing workbooks remain importable. Add the field to ItemEditor with label 一般表现表述 and initialize missing legacy values using defaultGeneralText.

Add generalText to extract-default-items.py, its required-field contract test, and the generated example workbook script. Run:

~~~powershell
pnpm extract:default-items
pnpm generate:checklist-import-template
python scripts/test_extract_default_items.py
pnpm exec vitest run src/features/items/excelImport.test.ts src/features/items/item-library.test.tsx
~~~

Expected: extraction remains deterministic, generated JSON contains the new field for every default item, both new and legacy Excel shapes parse, and item editing/import tests pass.

- [ ] Step 6: Commit the category/text foundation.

~~~powershell
git add -- app/src/domain/photoCategory.ts app/src/domain/models.ts app/src/domain/schemas.ts app/src/domain/inspection.ts app/src/domain/customChecklistItem.ts app/src/data/core-inspection-items.ts app/src/test/fixtures.ts app/src/features/items/excelImport.ts app/src/features/items/ItemEditor.tsx app/scripts/extract-default-items.py app/scripts/test_extract_default_items.py app/scripts/generate-checklist-import-template.mjs app/src/data/default-checklist-items.json app/public/fixtures/checklist-import-template.xlsx app/src/domain/inspection.test.ts app/src/features/items/excelImport.test.ts app/src/features/items/item-library.test.tsx
git commit -m "feat: add general photo evaluation category"
~~~

### Task 2: Extend Persistence, Category Rules, And Legacy Validation

**Files:**
- Modify: app/src/domain/schemas.ts
- Modify: app/src/db/inspectionRepository.ts
- Modify: app/src/domain/reportValidation.ts
- Modify: app/src/domain/reviewRouteOrder.ts
- Modify: app/src/features/review/reviewSummary.ts
- Test: app/src/db/repositories.test.ts
- Test: app/src/db/photoPersistence.test.ts
- Test: app/src/db/backupRepository.test.ts
- Test: app/src/domain/reportValidation.test.ts
- Test: app/src/domain/reviewRouteOrder.test.ts
- Test: app/src/features/review/reviewSummary.test.ts

**Interfaces:**
- Repository category transitions use the same descriptionForCategory helper as the UI.
- validateReportReadiness emits PHOTO_CATEGORY_NOT_IN_TEMPLATE when a photographed group category is absent from the referenced template.
- ReviewSummary.groups and ReviewSummary.photos contain all four PhotoCategory keys.

- [ ] Step 1: Write failing repository and validation tests.

Add tests that save and reload a general group, move a rewarded good group to general, and assert category: "general", the independent description, and awardAssessment: null. Add a report validation test with an old three-section template and a photographed general group that expects PHOTO_CATEGORY_NOT_IN_TEMPLATE. Add route-order and summary assertions for general.

Use this assertion:

~~~ts
const errors = validateReportReadiness(makeGraph({
  groups: [makePhotoGroup({ category: "general", description: "一般表现", photoIds: ["photo-1"] })],
}));

expect(errors).toContainEqual(expect.objectContaining({
  code: "PHOTO_CATEGORY_NOT_IN_TEMPLATE",
  field: "template.sections",
}));
~~~

- [ ] Step 2: Run the tests and verify the intended red failures.

~~~powershell
pnpm exec vitest run src/db/repositories.test.ts src/domain/reportValidation.test.ts src/domain/reviewRouteOrder.test.ts src/features/review/reviewSummary.test.ts
~~~

Expected: failures identify missing general category handling, missing summary keys, and missing template-category validation; unrelated repository tests should still load.

- [ ] Step 3: Implement persistence and validation rules.

Add general to reviewRouteOrderByCategorySchema and initialize it in sortRouteNamesForReviewByCategory. In inspectionRepository.ts, treat general like reminder for award compatibility and call descriptionForCategory when moving a group. In reportValidation.ts, reject any general or reminder group with award data, retain assessment and reward checks, and compare photographed group categories with the template section categories after template validation. Emit PHOTO_CATEGORY_NOT_IN_TEMPLATE with a message instructing the user to switch to the latest four-category template.

Initialize general: 0 in both summary records and increment it through the existing category-keyed code.

- [ ] Step 4: Run the tests and verify green.

Run the command from Step 2. Expected: all listed tests pass, including legacy three-category graphs without general photos and the explicit missing-section error when a general photo exists.

- [ ] Step 5: Verify backup compatibility before the commit.

Add a backup test that parses a legacy checklist item and item snapshot without generalText, then asserts the legacy payload remains accepted and descriptionForCategory supplies the deterministic fallback. Add a four-category photo group/template round-trip through the existing backup repository. Run:

~~~powershell
pnpm exec vitest run src/db/backupRepository.test.ts src/db/repositories.test.ts src/domain/reportValidation.test.ts
~~~

Expected: legacy backup payloads remain accepted, four-category payloads round-trip, and no photo references or historical template versions are dropped.

- [ ] Step 6: Commit persistence and validation.

~~~powershell
git add -- app/src/domain/schemas.ts app/src/db/inspectionRepository.ts app/src/domain/reportValidation.ts app/src/domain/reviewRouteOrder.ts app/src/features/review/reviewSummary.ts app/src/db/repositories.test.ts app/src/db/photoPersistence.test.ts app/src/db/backupRepository.test.ts app/src/domain/reportValidation.test.ts app/src/domain/reviewRouteOrder.test.ts app/src/features/review/reviewSummary.test.ts
git commit -m "feat: persist and validate general photo evaluations"
~~~

### Task 3: Seed Four-Section Templates And Settings UI

**Files:**
- Modify: app/src/app/dependencies.ts
- Modify: app/src/domain/schemas.ts
- Modify: app/src/domain/reportValidation.test.ts
- Modify: app/src/domain/photoLayout.test.ts
- Modify: app/src/app/dependencies.test.ts
- Modify: app/src/features/settings/TemplateSettingsPage.tsx
- Test: app/src/features/settings/template-settings.test.tsx

**Interfaces:**
- Legacy sections with exactly good, reminder, assessment remain valid.
- New sections with exactly good, general, reminder, assessment are valid.
- The newly seeded formal template is template-default version 3 and is the latest version on a fresh install or upgrade.

- [ ] Step 1: Write failing schema, seed, and settings tests.

Add a four-section template fixture and assert reportTemplateSchema.safeParse(fourSectionTemplate).success is true. Keep an explicit legacy three-section fixture and assert it remains valid. Assert a four-entry template missing general is invalid. Update the initialization test to expect formal version 3 with sections in the four-category order. Add a settings test that renders four chapter labels and saves a fourth chapter title into the next template version.

Use these section values:

~~~ts
sections: [
  { category: "good", title: "好的方面", order: 0 },
  { category: "general", title: "一般表现", order: 1 },
  { category: "reminder", title: "提醒问题", order: 2 },
  { category: "assessment", title: "考核问题", order: 3 },
],
~~~

- [ ] Step 2: Run the focused tests and verify red failures.

~~~powershell
pnpm exec vitest run src/domain/reportValidation.test.ts src/domain/photoLayout.test.ts src/app/dependencies.test.ts src/features/settings/template-settings.test.tsx
~~~

Expected: the new four-section assertions fail while existing legacy assertions still execute.

- [ ] Step 3: Implement schema compatibility and template version 3.

Change the report section schema check to accept only the legacy set or the current set. Use an explicit set comparison helper that checks set size and every expected value. Change the formal seeded template to version 3 and insert the general section at order 1, shifting reminder and assessment orders. Keep default v1 unchanged for historical compatibility. Change the domain fallback in createInspection from template version 2 to version 3; NewInspectionPage still overwrites it with the actual latest template.

Update TemplateSettingsPage to use photoCategoryLabel(section.category) rather than a three-branch conditional. Render the four sections from the loaded latest template without adding a separate fourth hard-coded row.

- [ ] Step 4: Run the focused tests and verify green.

Run the command from Step 2. Expected: legacy and four-section templates both validate, initialization exposes formal v3, and the settings page saves four sections.

- [ ] Step 5: Commit template support.

~~~powershell
git add -- app/src/app/dependencies.ts app/src/domain/schemas.ts app/src/domain/reportValidation.test.ts app/src/domain/photoLayout.test.ts app/src/app/dependencies.test.ts app/src/features/settings/TemplateSettingsPage.tsx app/src/features/settings/template-settings.test.tsx
git commit -m "feat: seed four-category Word template"
~~~

### Task 4: Add The Fourth Review Category And Responsive Tab Layout

**Files:**
- Modify: app/src/features/photos/PhotoGroupEditor.tsx
- Modify: app/src/features/review/ReviewPage.tsx
- Modify: app/src/features/review/ReviewRouteSortDialog.tsx
- Modify: app/src/styles/global.css
- Test: app/src/features/photos/PhotoGroupEditor.test.tsx
- Test: app/src/features/review/ReviewPage.test.tsx
- Test: app/src/features/review/ReviewDnd.test.tsx
- Test: app/src/features/review/ReviewRouteSortDialog.test.tsx

**Interfaces:**
- All category controls consume PHOTO_CATEGORIES and display 一般表现 in the second position.
- PhotoGroupEditor returns awardAssessment: null for general.
- ReviewPage renders a review-tab-general tab and uses summary.photos.general.
- The route sort dialog accepts a missing legacy general array as [] and saves all four keys when the dialog is used.

- [ ] Step 1: Write failing UI tests.

Add a photo-group editor test that selects the 一般表现 radio and verifies the group save payload has category: "general", the general description, and no award data. Extend the review page test graph with a general group and assert the 一般表现 1张 tab, linked tabpanel, and displayed photo. Add a route sort dialog test that renders an omitted legacy general array and verifies the section is shown as empty and save includes general: [].

- [ ] Step 2: Run UI tests and verify red failures.

~~~powershell
pnpm exec vitest run src/features/photos/PhotoGroupEditor.test.tsx src/features/review/ReviewPage.test.tsx src/features/review/ReviewDnd.test.tsx src/features/review/ReviewRouteSortDialog.test.tsx
~~~

Expected: failures identify the missing radio/tab/route-sort section and the incorrect award branch for general.

- [ ] Step 3: Implement the four-category UI.

Import PHOTO_CATEGORIES into PhotoGroupEditor, ReviewPage, and ReviewRouteSortDialog. Replace the duplicated three-element arrays. In PhotoGroupEditor.awardFor, return null when category === "general" || category === "reminder"; leave reward and assessment behavior unchanged. In the route sort dialog, initialize and save general with routeNamesByCategory.general ?? []. Keep the existing split, drag-drop, save queue, and keyboard focus behavior.

Change the review tab grid rule in app/src/styles/global.css from repeat(3, minmax(0, 1fr)) to repeat(4, minmax(0, 1fr)). Keep the existing minimum width, wrapping, focus, and selected-state rules.

- [ ] Step 4: Run UI tests and verify green.

Run the command from Step 2. Expected: fourth-category selection, review tab navigation, drag-drop category target, route sorting, and award visibility all pass.

- [ ] Step 5: Commit review UI support.

~~~powershell
git add -- app/src/features/photos/PhotoGroupEditor.tsx app/src/features/review/ReviewPage.tsx app/src/features/review/ReviewRouteSortDialog.tsx app/src/styles/global.css app/src/features/photos/PhotoGroupEditor.test.tsx app/src/features/review/ReviewPage.test.tsx app/src/features/review/ReviewDnd.test.tsx app/src/features/review/ReviewRouteSortDialog.test.tsx
git commit -m "feat: add general review category"
~~~

### Task 5: Include General Sections In Report Output Without Dropping Legacy Photos

**Files:**
- Modify: app/src/features/reports/reportModel.test.ts
- Modify: app/src/features/reports/generateDocx.test.ts
- Modify: app/tests/e2e/inspection-flow.spec.ts
- Modify: app/tests/e2e/word-export.spec.ts
- Inspect only unless a failing test proves it necessary: app/src/features/reports/reportModel.ts and app/src/features/reports/generateDocx.ts

**Interfaces:**
- buildReportModel continues to derive section order and titles from template.sections and includes general when the current template has it.
- generateDocx receives the same ReportModel shape and keeps fixed 3:4 image geometry and compression order.
- A legacy template with a photographed general group is rejected by readiness validation before buildReportModel or generateDocx runs.

- [ ] Step 1: Write failing report and DOCX tests.

Add a report model test with a four-section template and a general group; assert model.sections contains general in configured order and the group text has no reward or assessment suffix. Add an empty-general test asserting the heading is omitted. Add a DOCX XML test that generates a model with a general section and asserts the XML contains 一般表现 and the general group text while retaining existing photo relationship assertions.

Extend the E2E fixture flow so one photo is classified as 一般表现 and assert all four review tabs and the generated report path remain usable.

- [ ] Step 2: Run report tests and verify red failures.

~~~powershell
pnpm exec vitest run src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts src/domain/reportValidation.test.ts
~~~

Expected: the new four-section model/XML assertions fail only because fixtures and the category path are not yet wired; existing fixed-frame and media-budget tests remain runnable.

- [ ] Step 3: Make the minimal report changes required by the failing tests.

First verify that reportModel.ts already maps every template section by PhotoCategory and generateDocx.ts is category-agnostic. If the focused tests pass after fixture and validation changes, leave both production files unchanged. If a failure proves a category-specific branch is missing, add only the branch needed to preserve template order, empty-section filtering, and no award suffix for general. Do not alter imageTable, docxPhotoFrameAspectRatio, compression, annotations, or photo references.

- [ ] Step 4: Run report tests and verify green.

Run the command from Step 2. Expected: general sections appear in four-category reports, empty sections stay omitted, old three-category reports remain unchanged, and old templates with general photos are blocked before generation.

- [ ] Step 5: Run the browser-flow tests.

~~~powershell
pnpm exec playwright test tests/e2e/inspection-flow.spec.ts tests/e2e/word-export.spec.ts
~~~

Expected: the review flow can classify, count, navigate, sort, and export all four categories. If the local browser service is unavailable, record the exact missing service and continue with deterministic Vitest/DOCX checks; do not claim E2E success.

- [ ] Step 6: Commit report coverage.

~~~powershell
git add -- app/src/features/reports/reportModel.test.ts app/src/features/reports/generateDocx.test.ts app/tests/e2e/inspection-flow.spec.ts app/tests/e2e/word-export.spec.ts
git commit -m "test: cover general category in Word reports"
~~~

### Task 6: Full Verification And Local Android Artifact

**Files:**
- Modify: app/android/app/build.gradle
- Create: output/7S-inspection-v1.0.4-four-category.apk
- Test: all affected Vitest, Python, Playwright, lint, build, and Android checks.

**Interfaces:**
- Web package remains version-independent from the Android wrapper; Android version becomes versionName 1.0.4 and versionCode 5 only after web tests pass.
- APK is a local debug artifact with an ASCII filename; no GitHub upload or release mutation occurs in this task.

- [ ] Step 1: Run deterministic data and focused tests.

From C:/Users/xj/Desktop/7s管理/app, run:

~~~powershell
python scripts/test_extract_default_items.py
pnpm test:run -- src/domain/inspection.test.ts src/domain/reportValidation.test.ts src/domain/reviewRouteOrder.test.ts src/db/repositories.test.ts src/db/backupRepository.test.ts src/features/items/excelImport.test.ts src/features/photos/PhotoGroupEditor.test.tsx src/features/review/ReviewPage.test.tsx src/features/review/ReviewRouteSortDialog.test.tsx src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts src/app/dependencies.test.ts src/features/settings/template-settings.test.tsx
~~~

Expected: Python extraction passes and every listed Vitest file is green.

- [ ] Step 2: Run the full one-worker suite and stress suite.

~~~powershell
pnpm test:run -- --maxWorkers=1
pnpm test:stress -- --maxWorkers=1
~~~

Expected: the full suite reports zero failed tests and the stress suite reports its existing bounded-photo/reference assertions. Any known pre-existing asynchronous failure must be reproduced, isolated, and reported with its exact test name rather than silently ignored.

- [ ] Step 3: Run lint and production build.

~~~powershell
pnpm lint
pnpm build
~~~

Expected: both exit with code 0 and no TypeScript, lint, or Vite errors.

- [ ] Step 4: Increment Android version and build the APK.

After the web checks pass, update app/android/app/build.gradle from versionName 1.0.3/versionCode 4 to versionName 1.0.4/versionCode 5. From app/android, use JDK 21 and run:

~~~powershell
pnpm exec cap sync android
./gradlew.bat lintDebug assembleDebug
~~~

Copy the resulting debug APK to C:/Users/xj/Desktop/7s管理/output/7S-inspection-v1.0.4-four-category.apk, then verify package name, version, file size, and SHA-256 with apkanalyzer, Get-Item, and Get-FileHash. Do not upload it.

- [ ] Step 5: Run final repository checks.

From C:/Users/xj/Desktop/7s管理, run:

~~~powershell
git diff --check
git status --short --branch
git log -5 --oneline --decorate
~~~

Expected: no whitespace errors; the only intentionally untracked pre-existing project file remains app/docs/superpowers/plans/2026-08-03-word-photo-fixed-portrait-frame.md; the local APK is ignored or explicitly reported if untracked; no published release or token file changed.

- [ ] Step 6: Commit the version bump only after fresh verification.

~~~powershell
git add -- app/android/app/build.gradle
git commit -m "chore: bump Android app to 1.0.4"
~~~
