# 7S移动巡检与Word通报工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个供单人在安卓Chrome中使用的7S巡检PWA，使用户能够按固定项点拍摄和分类全部照片，并在手机本地生成正式可编辑的Word通报。

**Architecture:** 应用代码独立放在`app/`目录，使用React和TypeScript构建PWA。检查数据、压缩照片、项点库和模板保存在IndexedDB中；业务逻辑按项点、巡检、图片、复核、Word和备份模块拆分，Word在浏览器本地生成，不上传业务数据。

**Tech Stack:** React、TypeScript、Vite、Vitest、Testing Library、Playwright、Dexie、Zod、docx、ExcelJS、JSZip、browser-image-compression、Konva、dnd-kit、vite-plugin-pwa、Lucide React。

## Global Constraints

- 使用对象为单人，不设置账号、权限或多人协同。
- 目标设备为安卓手机，主浏览器为最新版Chrome。
- 所有巡检照片必须进入通报，只允许`good`、`reminder`、`assessment`三种类别。
- 同一项点照片数量不限；默认整组评价，单张调整时拆分为新照片组。
- 照片默认归入`good`，生成前必须进入复核页。
- 默认图片压缩参数为长边2000像素、JPEG质量0.85；单张允许高清保留。
- 默认不在照片上添加日期、时间、位置或项点水印。
- 好的方面奖励可选；考核责任人员手工填写，金额提供30元、50元、70元并允许自定义。
- Word正文按好的、提醒、考核分章，包含全部照片并附按路线生成的巡检明细表。
- Word默认每行3张照片，可配置为每行2张。
- 数据默认只保存在手机本地，支持整包备份和恢复。
- 第一阶段不实现整改追踪、周月统计、H/A/B/C等级、云端数据库或任意Word模板识别。
- 界面文字使用中文；代码标识符、文件名和测试名称使用英文ASCII。
- 图标统一使用Lucide React；不手绘功能图标，不使用装饰性卡片嵌套。

## Preflight Implementation Clarifications

The following clarifications resolve implementation conflicts found before Task 1.
They preserve the approved business scope and override conflicting task details below.

- Task 1 exports `App` both as a named export and a default export (or updates the
  entry import consistently), keeps the generated Oxlint setup, and merges rather
  than replaces existing ignore rules. Re-running Task 1 against an existing Vite
  scaffold must be idempotent.
- `ReportTemplate` is immutable and versioned. Dexie uses `[id+version]` as the
  template primary key, repositories read by `get(id, version)`, and an inspection
  snapshot always records both values. Template data also carries ordered section
  titles, photo spacing, and the signature date pattern required by the design.
- `validateReportReadiness()` accepts the complete `InspectionGraph`, not only
  groups. It verifies every persisted photo belongs to exactly one group, every
  group reference exists, `PhotoAsset.groupId` agrees with the group, and no photo
  ID is duplicated. Split, move, delete, and reorder operations are transactional.
- Excel handling is two-stage: parsing validates workbook rows, then
  `buildImportPreview(parsedItems, existingItems)` computes additions, changes,
  disables, and errors. Stable item IDs include the normalized inspection standard
  (or an explicit stable source key) so multiple standards at one location do not
  collide.
- GitHub Pages uses hash-based routing. Route and reload tests must cover a nested
  hash route; no server rewrite is assumed.
- The photo flow exposes per-photo high-quality retention, retry after processing
  failure, replace/retake, and delete actions. Failed `File` objects remain in a
  retry queue until retried or the user leaves the page.
- Valid category, description, people, amount, and ordering changes auto-save.
  A visible completion command may flush pending text but is never required for
  persistence. Changing category clears incompatible reward/assessment fields.
- The review page lets the user choose the immutable template version and a
  per-inspection two- or three-photo row override. These choices update the
  inspection snapshot without mutating global template defaults.
- A successfully reviewed inspection is `reviewed`; it becomes `generated` only
  after DOCX packaging succeeds. Editing generated content returns it to `draft`
  or `reviewed` according to whether readiness still passes.
- DOCX completeness tests count drawing/image references in `document.xml` and
  validate their relationships to the report model. They do not assume one media
  file per photo because byte-identical images may be deduplicated.
- Backup payloads include settings. Merge imports an inspection and its complete
  dependent graph atomically or skips the whole graph on ID conflict; templates
  merge by `[id+version]`, item/settings conflicts are reported, and any failed
  validation leaves the existing database unchanged.
- Offline/PWA E2E runs against a production build served by `vite preview` (or an
  equivalent static server), not the default Vite development server.
- Validation errors include `groupId`, field, code, and a Chinese message so the
  review page can focus the exact group. Backup manifest hashes cover every payload
  file except `manifest.json` itself.
- The shared domain graph is exactly:
  `InspectionGraph = { inspection: Inspection; groups: PhotoGroup[]; photos: PhotoAsset[]; template?: ReportTemplate }`.
  `Inspection.entries` remains the authoritative ordered entry snapshot list;
  repositories may normalize it into the `entries` table and reconstruct it on read.
- `ReportTemplate` adds `sections: Array<{ category: PhotoCategory; title: string; order: number }>`,
  `photoGapPt: number`, and `signatureDatePattern: string` alongside the fields listed
  in Task 2. A template version is addressed by the pair `(id, version)` and is never
  overwritten.

---

## File Structure

```text
7s管理/
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
├── app/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── index.html
│   ├── vite.config.ts
│   ├── playwright.config.ts
│   ├── tsconfig.json
│   ├── public/
│   │   ├── icons/
│   │   │   ├── icon-192.png
│   │   │   ├── icon-512.png
│   │   │   └── icon-maskable-512.png
│   │   └── fixtures/
│   │       └── checklist-import-template.xlsx
│   ├── scripts/
│   │   └── extract-default-items.py
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── app/
│   │   │   ├── router.tsx
│   │   │   └── AppShell.tsx
│   │   ├── domain/
│   │   │   ├── models.ts
│   │   │   ├── schemas.ts
│   │   │   ├── inspection.ts
│   │   │   └── reportValidation.ts
│   │   ├── db/
│   │   │   ├── database.ts
│   │   │   ├── inspectionRepository.ts
│   │   │   ├── itemRepository.ts
│   │   │   ├── templateRepository.ts
│   │   │   └── backupRepository.ts
│   │   ├── data/
│   │   │   └── default-checklist-items.json
│   │   ├── features/
│   │   │   ├── dashboard/DashboardPage.tsx
│   │   │   ├── items/ItemLibraryPage.tsx
│   │   │   ├── items/ItemEditor.tsx
│   │   │   ├── items/excelImport.ts
│   │   │   ├── inspections/NewInspectionPage.tsx
│   │   │   ├── inspections/InspectionPage.tsx
│   │   │   ├── inspections/ChecklistRouteList.tsx
│   │   │   ├── photos/PhotoCaptureButtons.tsx
│   │   │   ├── photos/PhotoGroupEditor.tsx
│   │   │   ├── photos/PhotoAnnotationDialog.tsx
│   │   │   ├── review/ReviewPage.tsx
│   │   │   ├── review/ReviewGroupList.tsx
│   │   │   ├── reports/reportModel.ts
│   │   │   ├── reports/generateDocx.ts
│   │   │   ├── reports/shareReport.ts
│   │   │   ├── history/HistoryPage.tsx
│   │   │   ├── history/TrashPage.tsx
│   │   │   ├── settings/SettingsPage.tsx
│   │   │   ├── settings/TemplateSettingsPage.tsx
│   │   │   └── settings/BackupPage.tsx
│   │   ├── lib/
│   │   │   ├── images/compressImage.ts
│   │   │   ├── images/renderAnnotation.ts
│   │   │   ├── files/downloadBlob.ts
│   │   │   ├── ids.ts
│   │   │   └── dates.ts
│   │   ├── styles/
│   │   │   ├── tokens.css
│   │   │   └── global.css
│   │   └── test/
│   │       ├── setup.ts
│   │       ├── fixtures.ts
│   │       └── renderWithRouter.tsx
│   └── tests/
│       ├── e2e/inspection-flow.spec.ts
│       ├── e2e/offline-resume.spec.ts
│       ├── e2e/word-export.spec.ts
│       └── fixtures/site-photo.jpg
└── docs/
    ├── field-acceptance.md
    └── superpowers/
        ├── specs/2026-07-28-7s-mobile-inspection-design.md
        └── plans/2026-07-28-7s-mobile-inspection-implementation.md
```

## Task 1: Repository, React Shell, and Test Harness

**Files:**
- Create: `.gitignore`
- Create: `app/` using the Vite React TypeScript template
- Modify: `app/vite.config.ts`
- Modify: `app/src/App.tsx`
- Create: `app/src/App.test.tsx`
- Create: `app/src/test/setup.ts`
- Create: `app/src/styles/tokens.css`
- Create: `app/src/styles/global.css`

**Interfaces:**
- Produces: a runnable React application, `pnpm test`, `pnpm build`, and the shared CSS tokens used by all later UI tasks.

- [ ] **Step 1: Initialize Git and scaffold the isolated app directory**

Run from `C:\Users\xj\Desktop\7s管理`:

```powershell
git init
pnpm create vite app --template react-ts
pnpm --dir app install
pnpm --dir app add react-router-dom dexie dexie-react-hooks zod docx exceljs jszip browser-image-compression konva react-konva @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities lucide-react
pnpm --dir app add -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event fake-indexeddb @playwright/test vite-plugin-pwa
```

Expected: `app/package.json` and `app/pnpm-lock.yaml` exist; dependency installation exits with code 0.

- [ ] **Step 2: Add repository ignores**

Create `.gitignore` with exactly:

```gitignore
tmp/
.tools/
app/node_modules/
app/dist/
app/coverage/
app/playwright-report/
app/test-results/
*.doc
*.docx
```

- [ ] **Step 3: Configure Vitest and write the failing shell test**

Set `app/vite.config.ts` to:

```ts
/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

Create `app/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
```

Create `app/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the 7S inspection title", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "7S巡检" })).toBeVisible();
});
```

Add package scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "test:run": "vitest run",
    "test:e2e": "playwright test",
    "lint": "eslint ."
  }
}
```

- [ ] **Step 4: Run the shell test and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/App.test.tsx
```

Expected: FAIL because the generated Vite `App` does not contain the heading `7S巡检` or does not export `App` as a named export.

- [ ] **Step 5: Implement the minimal shell and stable visual tokens**

Replace `app/src/App.tsx` with:

```tsx
import "./styles/global.css";

export function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <h1>7S巡检</h1>
      </header>
    </main>
  );
}
```

Create `app/src/styles/tokens.css`:

```css
:root {
  color-scheme: light;
  --color-ink: #17201d;
  --color-muted: #66726d;
  --color-surface: #ffffff;
  --color-canvas: #f3f5f4;
  --color-border: #cfd7d3;
  --color-accent: #146b4f;
  --color-good: #26734d;
  --color-reminder: #a16400;
  --color-assessment: #a33131;
  --radius-control: 6px;
  --tap-size: 44px;
  font-family: "Microsoft YaHei", Arial, sans-serif;
}
```

Create `app/src/styles/global.css`:

```css
@import "./tokens.css";

* { box-sizing: border-box; }
html, body, #root { min-height: 100%; margin: 0; }
body { background: var(--color-canvas); color: var(--color-ink); }
button, input, textarea, select { font: inherit; letter-spacing: 0; }
button { min-height: var(--tap-size); }
.app-shell { min-height: 100dvh; }
.topbar { background: var(--color-surface); border-bottom: 1px solid var(--color-border); padding: 12px 16px; }
.topbar h1 { font-size: 20px; line-height: 28px; margin: 0; letter-spacing: 0; }
```

- [ ] **Step 6: Verify and commit the shell**

Run:

```powershell
pnpm --dir app test:run
pnpm --dir app build
git add .gitignore app docs/superpowers
git commit -m "chore: scaffold 7s inspection pwa"
```

Expected: all tests PASS, Vite build succeeds, and the first commit is created.

## Task 2: Domain Model and Report Readiness Rules

**Files:**
- Create: `app/src/domain/models.ts`
- Create: `app/src/domain/schemas.ts`
- Create: `app/src/domain/inspection.ts`
- Create: `app/src/domain/reportValidation.ts`
- Create: `app/src/domain/inspection.test.ts`
- Create: `app/src/domain/reportValidation.test.ts`
- Create: `app/src/lib/ids.ts`
- Create: `app/src/lib/dates.ts`

**Interfaces:**
- Produces: `ChecklistItem`, `Inspection`, `InspectionEntry`, `PhotoGroup`, `PhotoAsset`, `ReportTemplate`, `createInspection()`, `createPhotoGroup()`, `splitPhotoIntoGroup()`, and `validateReportReadiness()`.
- Consumes: no application state; all functions remain pure so repositories and UI can call them safely.

- [ ] **Step 1: Write failing tests for defaults and single-photo splitting**

Create `app/src/domain/inspection.test.ts`:

```ts
import { createInspection, createPhotoGroup, splitPhotoIntoGroup } from "./inspection";
import type { ChecklistItem } from "./models";

const item: ChecklistItem = {
  id: "item-1",
  routeOrder: 1,
  routeName: "焊机间",
  area: "二线焊机",
  device: "焊机",
  part: "油缸",
  standard: "油缸表面无积灰、油泥",
  team: "焊接工班",
  sevenSCategory: "清扫",
  goodText: "油缸表面清理较干净。",
  reminderText: "油缸表面积灰、油泥清理不到位，本次予以提醒。",
  assessmentText: "油缸表面积灰、油泥未清理。",
  quickPhrases: ["积灰未清理", "油泥未清理"],
  enabled: true,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

test("new photo groups default to good and use the item good text", () => {
  const group = createPhotoGroup(item, "inspection-1", "entry-1", ["photo-1"], "group-1");
  expect(group.category).toBe("good");
  expect(group.description).toBe(item.goodText);
});

test("splitting a photo creates a new group and removes it from the old group", () => {
  const source = createPhotoGroup(item, "inspection-1", "entry-1", ["photo-1", "photo-2"], "group-1");
  const result = splitPhotoIntoGroup(source, "photo-1", "reminder", item, "group-2");
  expect(result.source.photoIds).toEqual(["photo-2"]);
  expect(result.created.photoIds).toEqual(["photo-1"]);
  expect(result.created.category).toBe("reminder");
  expect(result.created.description).toBe(item.reminderText);
});

test("new inspections snapshot selected items but do not require all items", () => {
  const inspection = createInspection([item], "inspection-1", "2026-07-28");
  expect(inspection.entries).toHaveLength(1);
  expect(inspection.entries[0].itemSnapshot.part).toBe("油缸");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/domain/inspection.test.ts
```

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Define exact domain contracts**

Create `app/src/domain/models.ts` with these exported types:

```ts
export type PhotoCategory = "good" | "reminder" | "assessment";
export type InspectionStatus = "draft" | "reviewed" | "generated";
export type SevenSCategory = "整理" | "整顿" | "清扫" | "清洁" | "素养" | "安全" | "节约" | "";

export interface ChecklistItem {
  id: string;
  routeOrder: number;
  routeName: string;
  area: string;
  device: string;
  part: string;
  standard: string;
  team: string;
  sevenSCategory: SevenSCategory;
  goodText: string;
  reminderText: string;
  assessmentText: string;
  quickPhrases: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AwardAssessment {
  type: "reward" | "assessment";
  people: string;
  amount: number;
}

export interface PhotoAsset {
  id: string;
  inspectionId: string;
  groupId: string;
  capturedAt: string;
  order: number;
  imageBlob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  highQuality: boolean;
  annotationJson: string | null;
}

export interface PhotoGroup {
  id: string;
  inspectionId: string;
  entryId: string;
  category: PhotoCategory;
  description: string;
  awardAssessment: AwardAssessment | null;
  photoIds: string[];
  order: number;
}

export interface ItemSnapshot extends Omit<ChecklistItem, "enabled" | "createdAt" | "updatedAt"> {}

export interface InspectionEntry {
  id: string;
  inspectionId: string;
  itemId: string;
  itemSnapshot: ItemSnapshot;
  groupIds: string[];
  order: number;
}

export interface Inspection {
  id: string;
  inspectionDate: string;
  title: string;
  templateId: string;
  templateVersion: number;
  status: InspectionStatus;
  entries: InspectionEntry[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReportTemplate {
  id: string;
  version: number;
  name: string;
  titlePattern: string;
  openingText: string;
  requirements: string[];
  closingText: string;
  organizationName: string;
  bodyFont: string;
  headingFont: string;
  titleFont: string;
  bodyFontSizePt: number;
  titleFontSizePt: number;
  lineSpacing: number;
  marginMm: { top: number; right: number; bottom: number; left: number };
  photosPerRow: 2 | 3;
}
```

Implement `createPhotoGroup(item, inspectionId, entryId, photoIds, groupId)` with the exact argument order used above. Implement `splitPhotoIntoGroup(source, photoId, category, item, createdGroupId)` so it returns `{ source, created }` and does not mutate the source object. Reject splitting when the source contains only one photo; the caller must change that group's category in place instead.

- [ ] **Step 4: Add report-readiness tests before implementation**

Create `app/src/domain/reportValidation.test.ts`:

```ts
import { validateReportReadiness } from "./reportValidation";
import type { PhotoGroup } from "./models";

const validGroup: PhotoGroup = {
  id: "group-1",
  inspectionId: "inspection-1",
  entryId: "entry-1",
  category: "good",
  description: "设备清洁较好。",
  awardAssessment: null,
  photoIds: ["photo-1"],
  order: 0,
};

test("rejects assessment groups without people and amount", () => {
  const errors = validateReportReadiness([{ ...validGroup, category: "assessment" }]);
  expect(errors.map((error) => error.code)).toEqual(["ASSESSMENT_DETAILS_REQUIRED"]);
});

test("rejects partially entered rewards", () => {
  const errors = validateReportReadiness([{ ...validGroup, awardAssessment: { type: "reward", people: "张三", amount: 0 } }]);
  expect(errors.map((error) => error.code)).toContain("REWARD_DETAILS_INCOMPLETE");
});

test("accepts complete groups", () => {
  const errors = validateReportReadiness([validGroup]);
  expect(errors).toEqual([]);
});
```

Implement `validateReportReadiness(groups)` with error codes `EMPTY_DESCRIPTION`, `EMPTY_PHOTO_GROUP`, `ASSESSMENT_DETAILS_REQUIRED`, and `REWARD_DETAILS_INCOMPLETE`.

- [ ] **Step 5: Run all domain tests and commit**

Run:

```powershell
pnpm --dir app test:run -- src/domain
pnpm --dir app build
git add app/src/domain app/src/lib
git commit -m "feat: define inspection domain model"
```

Expected: domain tests PASS and TypeScript build succeeds.

## Task 3: IndexedDB Schema and Transactional Repositories

**Files:**
- Create: `app/src/db/database.ts`
- Create: `app/src/db/inspectionRepository.ts`
- Create: `app/src/db/itemRepository.ts`
- Create: `app/src/db/templateRepository.ts`
- Create: `app/src/db/repositories.test.ts`

**Interfaces:**
- Consumes: domain interfaces from Task 2.
- Produces: `SevenSDb`, `InspectionRepository`, `ItemRepository`, `TemplateRepository`, and `createTestDb(name)`.

- [ ] **Step 1: Write a failing repository round-trip test**

Create `app/src/db/repositories.test.ts`:

```ts
import { createTestDb } from "./database";
import { InspectionRepository } from "./inspectionRepository";
import { makeInspection, makePhoto, makePhotoGroup } from "../test/fixtures";

test("saves an inspection graph and restores image blobs", async () => {
  const db = createTestDb("round-trip");
  const repository = new InspectionRepository(db);
  const inspection = makeInspection();
  const group = makePhotoGroup();
  const photo = makePhoto(new Blob(["photo-bytes"], { type: "image/jpeg" }));

  await repository.saveGraph({ inspection, groups: [group], photos: [photo] });
  const restored = await repository.getGraph(inspection.id);

  expect(restored?.inspection.id).toBe(inspection.id);
  expect(await restored?.photos[0].imageBlob.text()).toBe("photo-bytes");
  await db.delete();
});

test("soft delete moves an inspection to trash without deleting photos", async () => {
  const db = createTestDb("trash");
  const repository = new InspectionRepository(db);
  await repository.saveGraph({ inspection: makeInspection(), groups: [makePhotoGroup()], photos: [makePhoto()] });
  await repository.moveToTrash("inspection-1", "2026-07-28T10:00:00.000Z");
  expect((await repository.getGraph("inspection-1"))?.inspection.deletedAt).not.toBeNull();
  await db.delete();
});
```

- [ ] **Step 2: Run the repository tests and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/db/repositories.test.ts
```

Expected: FAIL because the database and repositories do not exist.

- [ ] **Step 3: Implement Dexie schema version 1**

Create `app/src/test/fixtures.ts` before implementing repositories:

```ts
import type { ChecklistItem, Inspection, PhotoAsset, PhotoGroup } from "../domain/models";

export function makeChecklistItem(): ChecklistItem {
  return {
    id: "item-1",
    routeOrder: 1,
    routeName: "焊机间",
    area: "二线焊机",
    device: "焊机",
    part: "油缸",
    standard: "油缸表面无积灰、油泥",
    team: "焊接工班",
    sevenSCategory: "清扫",
    goodText: "油缸表面清理较干净。",
    reminderText: "油缸表面清理不到位，本次予以提醒。",
    assessmentText: "油缸表面积灰、油泥未清理。",
    quickPhrases: ["积灰未清理", "油泥未清理"],
    enabled: true,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  };
}

export function makeInspection(): Inspection {
  const item = makeChecklistItem();
  const { enabled: _enabled, createdAt: _createdAt, updatedAt: _updatedAt, ...itemSnapshot } = item;
  return {
    id: "inspection-1",
    inspectionDate: "2026-07-28",
    title: "向塘钢轨焊接整修车间7月28日7S巡检通报",
    templateId: "template-default",
    templateVersion: 1,
    status: "draft",
    entries: [{ id: "entry-1", inspectionId: "inspection-1", itemId: item.id, itemSnapshot, groupIds: ["group-1"], order: 0 }],
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    deletedAt: null,
  };
}

export function makePhotoGroup(): PhotoGroup {
  return {
    id: "group-1",
    inspectionId: "inspection-1",
    entryId: "entry-1",
    category: "good",
    description: "油缸表面清理较干净。",
    awardAssessment: null,
    photoIds: ["photo-1"],
    order: 0,
  };
}

export function makePhoto(imageBlob = new Blob(["image"], { type: "image/jpeg" })): PhotoAsset {
  return {
    id: "photo-1",
    inspectionId: "inspection-1",
    groupId: "group-1",
    capturedAt: "2026-07-28T00:00:00.000Z",
    order: 0,
    imageBlob,
    thumbnailBlob: new Blob(["thumb"], { type: "image/jpeg" }),
    width: 1200,
    height: 1600,
    highQuality: false,
    annotationJson: null,
  };
}
```

`SevenSDb` must define these tables and indexes:

```ts
this.version(1).stores({
  checklistItems: "id, routeOrder, routeName, area, device, enabled, updatedAt",
  inspections: "id, inspectionDate, status, updatedAt, deletedAt",
  entries: "id, inspectionId, itemId, [inspectionId+order]",
  photoGroups: "id, inspectionId, entryId, category, [inspectionId+order]",
  photos: "id, inspectionId, groupId, [groupId+order], capturedAt",
  templates: "id, version, name",
  settings: "key",
});
```

`saveGraph()` must store the inspection row without its embedded `entries` array, then write entries, groups, and photos in one `rw` transaction. Moving a photo to a newly split group must update both groups and `PhotoAsset.groupId` in that same transaction. `getGraph()` reconstructs the domain `Inspection.entries` array. `purgeInspection()` must delete all related rows in one transaction. `getGraph()` must return `null` for unknown IDs and preserve Blob values.

- [ ] **Step 4: Add immutable item-snapshot and template-version tests**

Add tests proving that editing a `ChecklistItem` after creating an inspection does not change `InspectionEntry.itemSnapshot`, and that a generated inspection retains its original `templateVersion` after a new template version is saved.

- [ ] **Step 5: Verify database behavior and commit**

Run:

```powershell
pnpm --dir app test:run -- src/db
git add app/src/db app/src/test/fixtures.ts
git commit -m "feat: persist inspections in indexeddb"
```

Expected: repository tests PASS with `fake-indexeddb` and no open database handles remain after each test.

## Task 4: Default Item Extraction and Excel Item Library Import

**Files:**
- Create: `app/scripts/extract-default-items.py`
- Create: `app/src/data/default-checklist-items.json`
- Create: `app/src/features/items/excelImport.ts`
- Create: `app/src/features/items/excelImport.test.ts`
- Create: `app/public/fixtures/checklist-import-template.xlsx`
- Modify: `app/package.json`

**Interfaces:**
- Consumes: `ChecklistItem` and `ItemRepository`.
- Produces: `parseChecklistWorkbook(file): Promise<ImportPreview>`, `applyItemImport(preview, repository)`, and a reproducible initial item JSON generated from the embedded responsibility workbook in `向塘钢轨焊接整修7S管理考核办法.docx`.

- [ ] **Step 1: Write failing Excel row-validation tests**

Create `app/src/features/items/excelImport.test.ts`:

```ts
import { validateImportRows } from "./excelImport";

test("accepts a complete item row", () => {
  const preview = validateImportRows([{
    路线顺序: 1,
    路线名称: "焊机间",
    区域: "二线焊机",
    设备岗位: "焊机",
    检查部位: "油缸",
    检查标准: "表面无积灰、油泥",
    责任工班: "焊接工班",
    "7S类别": "清扫",
    好的表述: "油缸表面清理较干净。",
    提醒表述: "油缸表面清理不到位，本次予以提醒。",
    考核表述: "油缸表面积灰、油泥未清理。",
    常见问题: "积灰未清理|油泥未清理",
    是否启用: "是",
  }]);
  expect(preview.errors).toEqual([]);
  expect(preview.items[0].quickPhrases).toEqual(["积灰未清理", "油泥未清理"]);
});

test("reports exact row and field names for invalid rows", () => {
  const preview = validateImportRows([{ 路线顺序: "abc", 路线名称: "" }]);
  expect(preview.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ row: 2, field: "路线顺序" }),
    expect.objectContaining({ row: 2, field: "路线名称" }),
  ]));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/features/items/excelImport.test.ts
```

Expected: FAIL because the import module does not exist.

- [ ] **Step 3: Implement the import contract and workbook template**

Use ExcelJS to read only the first worksheet. Normalize strings with `.trim()`, split `常见问题` on `|`, accept only the seven allowed 7S category values or blank, and reject duplicate derived item IDs. Derive a stable ID from `路线名称/区域/设备岗位/检查部位` using SHA-256 truncated to 16 hexadecimal characters.

`ImportPreview` must be:

```ts
export interface ImportError { row: number; field: string; message: string }
export interface ImportPreview {
  items: ChecklistItem[];
  errors: ImportError[];
  added: string[];
  changed: string[];
  disabled: string[];
}
```

Generate `checklist-import-template.xlsx` with the exact columns in the test and one example row. Importing the example workbook must produce one valid item.

- [ ] **Step 4: Add the reproducible source-data extraction script**

`extract-default-items.py` must:

1. Open `../向塘钢轨焊接整修7S管理考核办法.docx` as ZIP.
2. Read `word/embeddings/oleObject1.bin` with `xlrd`.
3. Read sheet `包保划分表`, beginning at Excel row 3.
4. Resolve merged-cell values for包保区域 and具体标准.
5. Split numbered standards such as `1、... 2、...` into separate fixed items.
6. Emit UTF-8 JSON matching `ChecklistItem[]`.
7. Generate default text as `${检查部位}落实较好。`, `${检查部位}落实不到位，本次予以提醒。`, and `${检查部位}落实不到位。` when source-specific text is unavailable.
8. Derive the same16-character SHA-256 ID used by the browser importer from the canonical route/area/device/part key.

Run in an ignored local tool environment:

```powershell
python -m venv .tools
.\.tools\Scripts\python.exe -m pip install xlrd==2.0.2
.\.tools\Scripts\python.exe app\scripts\extract-default-items.py --source "向塘钢轨焊接整修7S管理考核办法.docx" --output "app\src\data\default-checklist-items.json"
```

Expected: JSON contains enabled items with non-empty route, area, part, standard, team, and three default texts. Manually compare at least 10 rows against the source attachment before commit.

- [ ] **Step 5: Verify import preview and commit**

Run:

```powershell
pnpm --dir app test:run -- src/features/items
pnpm --dir app build
git add app/scripts app/src/data app/src/features/items app/public/fixtures app/package.json app/pnpm-lock.yaml
git commit -m "feat: add configurable checklist item library"
```

Expected: valid rows import, invalid rows remain unapplied, and the generated default item JSON is deterministic across two script runs.

## Task 5: App Routing, Dashboard, and Inspection Item Selection

**Files:**
- Create: `app/src/app/router.tsx`
- Create: `app/src/app/AppShell.tsx`
- Modify: `app/src/main.tsx`
- Modify: `app/src/App.tsx`
- Create: `app/src/features/dashboard/DashboardPage.tsx`
- Create: `app/src/features/inspections/NewInspectionPage.tsx`
- Create: `app/src/features/inspections/InspectionPage.tsx`
- Create: `app/src/features/inspections/ChecklistRouteList.tsx`
- Create: `app/src/features/inspections/inspection-flow.test.tsx`
- Create: `app/src/test/renderWithRouter.tsx`

**Interfaces:**
- Consumes: item and inspection repositories.
- Produces: routes `/`, `/inspections/new`, `/inspections/:id`, and a draft that snapshots only the user-selected enabled items.

- [ ] **Step 1: Write a failing user-flow test**

Create `app/src/features/inspections/inspection-flow.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithRouter";

test("creates a draft from selected routes without requiring every item", async () => {
  const user = userEvent.setup();
  renderWithRouter({ initialPath: "/inspections/new" });
  await user.click(screen.getByRole("checkbox", { name: "焊机间" }));
  await user.click(screen.getByRole("button", { name: "开始检查" }));
  expect(await screen.findByRole("heading", { name: /7S巡检/ })).toBeVisible();
  expect(screen.getByText("二线焊机")).toBeVisible();
  expect(screen.queryByText("基地办公楼二楼")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/features/inspections/inspection-flow.test.tsx
```

Expected: FAIL because the router and pages do not exist.

- [ ] **Step 3: Implement the quiet operational shell**

Use a full-width top bar and unframed list layout. Add Lucide icons to command buttons. Do not add explanatory marketing text, decorative hero content, nested cards, gradient backgrounds, or rounded text pills. All interactive targets must be at least44px high and must fit at360px viewport width.

`AppShell` must render a top bar, page content, and a five-item bottom navigation for首页、巡检、历史、项点、设置. The active navigation item uses `aria-current="page"`.

- [ ] **Step 4: Implement draft creation and route list behavior**

`NewInspectionPage` loads enabled items, groups them by `routeName`, and lets the user select any subset. `开始检查` is enabled when at least one route is selected. The title uses `向塘钢轨焊接整修车间M月D日7S巡检通报`.

`InspectionPage` shows route, area/device, fixed part, existing photo count, and category count. Search matches route, area, device, part, and standard. No completion gate exists for untouched items.

- [ ] **Step 5: Verify responsive behavior and commit**

Run:

```powershell
pnpm --dir app test:run -- src/features/inspections
pnpm --dir app build
git add app/src/app app/src/features/dashboard app/src/features/inspections app/src/main.tsx app/src/App.tsx app/src/test app/src/styles
git commit -m "feat: add mobile inspection navigation"
```

Expected: flow test PASS; no horizontal scrollbar at360px width in a manual browser check.

## Task 6: Camera, Album Import, Compression, and Photo Persistence

**Files:**
- Create: `app/src/lib/images/compressImage.ts`
- Create: `app/src/lib/images/compressImage.test.ts`
- Create: `app/src/features/photos/PhotoCaptureButtons.tsx`
- Create: `app/src/features/photos/PhotoCaptureButtons.test.tsx`
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Modify: `app/src/db/inspectionRepository.ts`
- Add: `app/tests/fixtures/site-photo.jpg`

**Interfaces:**
- Produces: `processImage(file, options): Promise<ProcessedImage>` and camera/gallery controls.
- `ProcessedImage` returns `imageBlob`, `thumbnailBlob`, `width`, `height`, and `highQuality`.

- [ ] **Step 1: Write failing pure image-option tests**

Create `app/src/lib/images/compressImage.test.ts`:

```ts
import { getCompressionPlan } from "./compressImage";

test("uses 2000px and 0.85 quality by default", () => {
  expect(getCompressionPlan({ width: 4032, height: 3024, highQuality: false })).toEqual({
    maxWidthOrHeight: 2000,
    initialQuality: 0.85,
    fileType: "image/jpeg",
  });
});

test("keeps the original maximum dimension in high quality mode", () => {
  expect(getCompressionPlan({ width: 4032, height: 3024, highQuality: true }).maxWidthOrHeight).toBe(4032);
});
```

- [ ] **Step 2: Write failing camera-control tests**

Test that the camera input has `accept="image/*"` and `capture="environment"`, while the gallery input has `accept="image/*"`, `multiple`, and no `capture` attribute. Verify buttons are named `拍照` and `从相册选择`.

- [ ] **Step 3: Run and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/lib/images src/features/photos/PhotoCaptureButtons.test.tsx
```

Expected: FAIL because photo modules do not exist.

- [ ] **Step 4: Implement sequential processing and immediate persistence**

Use `browser-image-compression` one file at a time. Generate a320px thumbnail after the report image. Correct orientation before measuring dimensions. Reject non-image files with the Chinese message `只能选择图片文件`.

After each file succeeds:

1. Create a `PhotoAsset`.
2. Append it to a new or active `PhotoGroup` with category `good`.
3. Persist the photo and group transaction immediately.
4. Update visible progress as `已处理 X/Y`.

If one file fails, retain already processed files and show the failing file name; do not roll back the successful images.

- [ ] **Step 5: Add file-input integration coverage**

Use Testing Library `user.upload()` with `site-photo.jpg` and assert that the created group uses the item's `goodText`. Add a Playwright smoke test that uses `setInputFiles()` for the gallery input and sees one thumbnail.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
pnpm --dir app test:run -- src/lib/images src/features/photos
pnpm --dir app test:e2e -- --grep "photo import"
git add app/src/lib/images app/src/features/photos app/src/features/inspections app/src/db app/tests
git commit -m "feat: capture and compress inspection photos"
```

Expected: image tests PASS; a real Android manual check confirms the `拍照` button opens the rear-camera flow.

## Task 7: Group Evaluation, Rewards, Assessments, and Photo Annotation

**Files:**
- Create: `app/src/features/photos/PhotoGroupEditor.tsx`
- Create: `app/src/features/photos/PhotoGroupEditor.test.tsx`
- Create: `app/src/features/photos/PhotoAnnotationDialog.tsx`
- Create: `app/src/lib/images/renderAnnotation.ts`
- Create: `app/src/lib/images/renderAnnotation.test.ts`
- Modify: `app/src/domain/inspection.ts`
- Modify: `app/src/db/inspectionRepository.ts`

**Interfaces:**
- Consumes: `PhotoGroup`, `ChecklistItem`, `splitPhotoIntoGroup()`.
- Produces: persisted category/description/reward/assessment edits and serializable annotation JSON.

- [ ] **Step 1: Write failing group-editor tests**

Define the component contract before the tests:

```ts
export interface PhotoGroupEditorProps {
  item: ChecklistItem;
  group: PhotoGroup;
  photos: PhotoAsset[];
  onSave: (group: PhotoGroup) => Promise<void>;
  onSplit: (photoId: string, category: PhotoCategory) => Promise<void>;
}
```

Use a segmented control with accessible radio names `好的方面`, `提醒问题`, and `考核问题`. Write these executable tests:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhotoGroupEditor } from "./PhotoGroupEditor";
import { makeChecklistItem, makePhoto, makePhotoGroup } from "../../test/fixtures";

test("switching to reminder replaces untouched good text with reminder text", async () => {
  const user = userEvent.setup();
  const item = makeChecklistItem();
  render(<PhotoGroupEditor item={item} group={makePhotoGroup()} photos={[makePhoto()]} onSave={vi.fn()} onSplit={vi.fn()} />);
  await user.click(screen.getByRole("radio", { name: "提醒问题" }));
  expect(screen.getByRole("textbox", { name: "评价说明" })).toHaveValue(item.reminderText);
});

test("edited text is not overwritten when category changes", async () => {
  const user = userEvent.setup();
  const item = makeChecklistItem();
  render(<PhotoGroupEditor item={item} group={makePhotoGroup()} photos={[makePhoto()]} onSave={vi.fn()} onSplit={vi.fn()} />);
  await user.clear(screen.getByRole("textbox", { name: "评价说明" }));
  await user.type(screen.getByRole("textbox", { name: "评价说明" }), "现场补充说明");
  await user.click(screen.getByRole("radio", { name: "提醒问题" }));
  expect(screen.getByRole("textbox", { name: "评价说明" })).toHaveValue("现场补充说明");
});

test("good groups save an optional complete reward", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<PhotoGroupEditor item={makeChecklistItem()} group={makePhotoGroup()} photos={[makePhoto()]} onSave={onSave} onSplit={vi.fn()} />);
  await user.click(screen.getByRole("checkbox", { name: "设置奖励" }));
  await user.type(screen.getByRole("textbox", { name: "奖励人员" }), "张三");
  await user.click(screen.getByRole("button", { name: "50元" }));
  await user.click(screen.getByRole("button", { name: "保存评价" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    awardAssessment: { type: "reward", people: "张三", amount: 50 },
  }));
});

test("assessment groups accept manual people and a custom amount", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<PhotoGroupEditor item={makeChecklistItem()} group={makePhotoGroup()} photos={[makePhoto()]} onSave={onSave} onSplit={vi.fn()} />);
  await user.click(screen.getByRole("radio", { name: "考核问题" }));
  await user.type(screen.getByRole("textbox", { name: "考核人员" }), "李四");
  await user.type(screen.getByRole("spinbutton", { name: "其他金额" }), "120");
  await user.click(screen.getByRole("button", { name: "保存评价" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    category: "assessment",
    awardAssessment: { type: "assessment", people: "李四", amount: 120 },
  }));
});

test("changing one selected photo requests a new group", async () => {
  const user = userEvent.setup();
  const onSplit = vi.fn().mockResolvedValue(undefined);
  const first = makePhoto();
  const second = { ...makePhoto(), id: "photo-2", order: 1 };
  const group = { ...makePhotoGroup(), photoIds: [first.id, second.id] };
  render(<PhotoGroupEditor item={makeChecklistItem()} group={group} photos={[first, second]} onSave={vi.fn()} onSplit={onSplit} />);
  await user.click(screen.getByRole("button", { name: "调整照片 photo-1" }));
  await user.click(screen.getByRole("menuitem", { name: "提醒问题" }));
  expect(onSplit).toHaveBeenCalledWith("photo-1", "reminder");
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/features/photos/PhotoGroupEditor.test.tsx
```

Expected: FAIL because the editor does not exist.

- [ ] **Step 3: Implement exact category behavior**

Track `descriptionSource` as `preset` or `edited` in component state. A category change replaces description only when source is `preset`. Reward inputs appear only for `good`; assessment people and amount appear only for `assessment`. Persist text changes with a300ms debounce and flush pending changes on page navigation. When a group has one photo, a per-photo category adjustment updates the existing group instead of splitting; only multi-photo groups create a new group.

Use number buttons30、50、70 plus a numeric input labelled `其他金额`. Accept any positive safe integer; reject zero, negative, decimal, or non-numeric values with `请输入大于0的整数金额`.

- [ ] **Step 4: Implement optional annotation storage**

Define annotation JSON as:

```ts
export type AnnotationShape =
  | { type: "ellipse"; x: number; y: number; width: number; height: number; color: "#d12f2f" }
  | { type: "arrow"; points: number[]; color: "#d12f2f" }
  | { type: "text"; x: number; y: number; text: string; color: "#d12f2f" };
```

The dialog opens only from the edit icon, supports undo, clear, cancel, and save, and stores normalized coordinates so annotations scale with the image. `renderAnnotation()` must produce a JPEG with the same aspect ratio as the source image for Word export.

- [ ] **Step 5: Verify annotation and group persistence**

Run:

```powershell
pnpm --dir app test:run -- src/features/photos src/lib/images/renderAnnotation.test.ts
git add app/src/features/photos app/src/lib/images app/src/domain app/src/db
git commit -m "feat: classify and annotate photo groups"
```

Expected: all group-editor cases PASS, serialized annotations survive a database reload, and cancelling annotation leaves the original photo unchanged.

## Task 8: Review, Validation, Statistics, and Reordering

**Files:**
- Create: `app/src/features/review/ReviewPage.tsx`
- Create: `app/src/features/review/ReviewGroupList.tsx`
- Create: `app/src/features/review/reviewSummary.ts`
- Create: `app/src/features/review/reviewSummary.test.ts`
- Create: `app/src/features/review/ReviewPage.test.tsx`
- Modify: `app/src/app/router.tsx`

**Interfaces:**
- Consumes: inspection graph and `validateReportReadiness()`.
- Produces: `buildReviewSummary(groups)` and a reviewed inspection with stable group/photo order.

- [ ] **Step 1: Write failing summary tests**

Create tests proving that:

- good/reminder/assessment group counts are separate;
- photo counts include every photo in every group;
- reward and assessment totals sum independently;
- an80-photo fixture reports80 total photos;
- moving a group or photo rewrites consecutive zero-based order values.

The expected summary contract is:

```ts
export interface ReviewSummary {
  groups: Record<PhotoCategory, number>;
  photos: Record<PhotoCategory, number>;
  rewardAmount: number;
  assessmentAmount: number;
  totalPhotos: number;
}
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/features/review
```

Expected: FAIL because review modules do not exist.

- [ ] **Step 3: Implement review tabs and validation feedback**

Render three tabs with counts, not colored text pills. Use dnd-kit for group and photo ordering. Every error returned by `validateReportReadiness()` must link to and focus the exact group. The `生成Word` command remains disabled while errors exist and displays the first error beside the button.

Do not require untouched fixed items. Only entries with at least one photo appear in review.

- [ ] **Step 4: Add user-interaction tests**

Test that an incomplete assessment blocks generation, entering people and amount clears the error, and reordering a photo persists after unmount and remount.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm --dir app test:run -- src/features/review src/domain/reportValidation.test.ts
git add app/src/features/review app/src/app/router.tsx
git commit -m "feat: add report review and validation"
```

Expected: review tests PASS and every photo is visible in exactly one category tab.

## Task 9: Configurable Word Generation and Mobile Download

**Files:**
- Create: `app/src/features/reports/reportModel.ts`
- Create: `app/src/features/reports/reportModel.test.ts`
- Create: `app/src/features/reports/generateDocx.ts`
- Create: `app/src/features/reports/generateDocx.test.ts`
- Create: `app/src/features/reports/shareReport.ts`
- Create: `app/src/lib/files/downloadBlob.ts`
- Modify: `app/src/features/review/ReviewPage.tsx`
- Modify: `app/src/db/templateRepository.ts`

**Interfaces:**
- Produces: `buildReportModel(graph, template)`, `generateDocx(model, onProgress): Promise<Blob>`, `buildReportFilename(date)`, and `shareOrDownloadReport(blob, filename)`.
- `onProgress` receives `{ completedImages, totalImages, phase }` where phase is `images`, `document`, or `save`.

- [ ] **Step 1: Write failing report-model tests**

Test exact section order `good`, `reminder`, `assessment`; automatic numbering within each section; reward text `（奖励：张三，50元）`; assessment text `（考核：李四，70元）`; omission of untouched items; and annex rows ordered by route, entry, and group order.

Expected filename for2026-07-28:

```text
向塘钢轨焊接整修车间7月28日7S巡检通报.docx
```

- [ ] **Step 2: Write a failing DOCX package test**

Generate a report with five photos and load the resulting Blob with JSZip. Assert:

```ts
expect(await zip.file("word/document.xml")?.async("string")).toContain("好的方面");
expect(Object.keys(zip.files).filter((name) => name.startsWith("word/media/"))).toHaveLength(5);
```

Also assert that the document XML contains reminder and assessment headings, the organization name, date, and annex table text.

- [ ] **Step 3: Run and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/features/reports
```

Expected: FAIL because report modules do not exist.

- [ ] **Step 4: Implement the default structured template**

Seed a template with:

- title pattern `向塘钢轨焊接整修车间M月D日“7S”巡检通报`;
- opening and ten general requirements copied from the July巡检通报;
- section names `好的方面`, `提醒问题`, `考核问题`;
- organization `向塘钢轨焊接整修车间`;
- body font `宋体`, heading font `黑体`, title font `方正小标宋简体`;
- A4 portrait,20mm top/bottom and22mm left/right margins;
- default3 photos per row.

Do not parse arbitrary user-uploaded Word templates.

- [ ] **Step 5: Implement deterministic DOCX layout**

Use a borderless `docx.Table` for each photo grid. Compute available content width from page width and margins, divide by2 or3, and scale every image within the cell while preserving aspect ratio. Render annotations before creating `ImageRun`. Keep a group's description and first photo row together when possible. Add an annex table with columns序号、检查路线、区域设备、检查部位、评价类别、照片数量、责任工班.

Process image blobs sequentially and invoke progress after each image. Never omit an image because of category, size, or orientation.

- [ ] **Step 6: Implement share with download fallback**

If `navigator.canShare({ files: [file] })` is true, call `navigator.share()`. If it is false or share is cancelled, preserve the generated Blob and display a separate `下载Word` button. Do not treat user cancellation as a generation failure.

- [ ] **Step 7: Stress-test the generator and commit**

Add a non-default Vitest test that generates100 small JPEG fixtures and verifies100 media files. Run:

```powershell
pnpm --dir app test:run -- src/features/reports
pnpm --dir app test:run -- src/features/reports/generateDocx.test.ts -t "100 photos"
git add app/src/features/reports app/src/lib/files app/src/features/review app/src/db/templateRepository.ts
git commit -m "feat: generate complete word inspection reports"
```

Expected: all report tests PASS and the progress callback reaches100/100 before save.

## Task 10: History, Trash, Item Editing, and Template Settings

**Files:**
- Create: `app/src/features/history/HistoryPage.tsx`
- Create: `app/src/features/history/TrashPage.tsx`
- Create: `app/src/features/history/history.test.tsx`
- Create: `app/src/features/items/ItemLibraryPage.tsx`
- Create: `app/src/features/items/ItemEditor.tsx`
- Create: `app/src/features/items/item-library.test.tsx`
- Create: `app/src/features/settings/SettingsPage.tsx`
- Create: `app/src/features/settings/TemplateSettingsPage.tsx`
- Create: `app/src/features/settings/template-settings.test.tsx`
- Modify: `app/src/app/router.tsx`

**Interfaces:**
- Consumes: repositories and Excel import from prior tasks.
- Produces: history filters, soft delete/restore/purge, item create/edit/disable, and versioned template settings.

- [ ] **Step 1: Write failing history tests**

Cover filtering by date, route/area text, category, and manually entered people. Test that `删除` performs soft delete, `恢复` clears `deletedAt`, and `彻底删除` removes inspection rows, groups, and photos only after a confirmation dialog. Test that `复制为新巡检` creates a new draft with the same selected item snapshots and template, but with no photo groups, photos, rewards, assessments, or old descriptions.

- [ ] **Step 2: Write failing item-library and template tests**

Test mobile editing of one item, disabling without deleting historical snapshots, Excel preview before apply, and template version increment when font, margins, fixed paragraphs, or photos per row change. Only values2 and3 are allowed for `photosPerRow`.

- [ ] **Step 3: Run and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/features/history src/features/items src/features/settings
```

Expected: FAIL because pages do not exist.

- [ ] **Step 4: Implement history and destructive-action guards**

History rows show date, title, three category counts, total photos, reward total, assessment total, and status. Use icon buttons with accessible labels for打开、重新生成、复制为新巡检、删除. Purge requires a modal naming the exact report title and stating that photos cannot be recovered after purge. Copying creates a fresh inspection date and ID, keeps only selected item snapshots and template settings, and never carries old photos or奖考数据 forward.

- [ ] **Step 5: Implement item and template settings**

Use full-width settings sections, not cards inside cards. Excel import shows新增、修改、停用、错误 counts and an error table before apply. Template settings save a new version rather than mutating an existing version. Existing inspection snapshots retain their template version.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
pnpm --dir app test:run -- src/features/history src/features/items src/features/settings
pnpm --dir app build
git add app/src/features/history app/src/features/items app/src/features/settings app/src/app/router.tsx
git commit -m "feat: manage history items and report templates"
```

Expected: history filters and settings tests PASS; purge never runs without confirmation.

## Task 11: Backup, Restore, Storage Persistence, and Capacity Warnings

**Files:**
- Create: `app/src/db/backupRepository.ts`
- Create: `app/src/db/backupRepository.test.ts`
- Create: `app/src/features/settings/BackupPage.tsx`
- Create: `app/src/features/settings/BackupPage.test.tsx`
- Modify: `app/src/db/database.ts`
- Modify: `app/src/features/dashboard/DashboardPage.tsx`

**Interfaces:**
- Produces: `createBackup(db): Promise<Blob>`, `inspectBackup(blob): Promise<BackupPreview>`, `restoreBackup(blob, mode)`, `requestPersistentStorage()`, and `readStorageEstimate()`.
- Restore mode is exactly `replace` or `merge`.

- [ ] **Step 1: Write failing backup round-trip tests**

Create a database containing one item, one template, one inspection, one group, and two image blobs. Export, delete the database, restore in `replace` mode, and assert every scalar and image byte matches. Corrupt `manifest.json` and verify restore refuses to mutate the existing database.

Backup ZIP structure must be:

```text
manifest.json
data/checklist-items.json
data/templates.json
data/inspections.json
data/entries.json
data/photo-groups.json
data/photos.json
photos/<photo-id>.jpg
photos/<photo-id>-thumb.jpg
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
pnpm --dir app test:run -- src/db/backupRepository.test.ts
```

Expected: FAIL because backup functions do not exist.

- [ ] **Step 3: Implement checksummed backup and safe restore**

`manifest.json` must include `schemaVersion: 1`, `createdAt`, row counts, and SHA-256 for every JSON and image file. `inspectBackup()` verifies all hashes before returning counts. `replace` clears tables only inside the final restore transaction. `merge` imports missing inspection IDs and skips existing IDs, reporting skipped IDs; it must not rewrite existing inspections.

- [ ] **Step 4: Implement persistent-storage and quota UI**

Call `navigator.storage.persist()` once after explicit user action on the Backup page. Show granted or not granted. Use `navigator.storage.estimate()` to show used and available bytes. Warn at80% usage and block new photo persistence at95% after saving the active draft metadata.

Display a backup reminder after every fourth inspection reaches `generated`. Allow dismissing until the next generated inspection.

- [ ] **Step 5: Verify failure recovery and commit**

Run:

```powershell
pnpm --dir app test:run -- src/db/backupRepository.test.ts src/features/settings/BackupPage.test.tsx
git add app/src/db app/src/features/settings/BackupPage.tsx app/src/features/settings/BackupPage.test.tsx app/src/features/dashboard
git commit -m "feat: add local backup and storage safeguards"
```

Expected: backup round-trip PASS, corrupted backup leaves the database byte-for-byte unchanged, and merge reports collisions.

## Task 12: PWA Installation, Offline Resume, Deployment, and Field Acceptance

**Files:**
- Modify: `app/vite.config.ts`
- Modify: `app/src/main.tsx`
- Create: `app/public/icons/icon-192.png`
- Create: `app/public/icons/icon-512.png`
- Create: `app/public/icons/icon-maskable-512.png`
- Create: `app/playwright.config.ts`
- Create: `app/tests/e2e/inspection-flow.spec.ts`
- Create: `app/tests/e2e/offline-resume.spec.ts`
- Create: `app/tests/e2e/word-export.spec.ts`
- Create: `.github/workflows/deploy-pages.yml`
- Create: `app/README.md`
- Create: `docs/field-acceptance.md`

**Interfaces:**
- Produces: installable HTTPS PWA, cached application shell, GitHub Pages build artifact, automated mobile flow coverage, and the manual Android/WPS acceptance checklist.

- [ ] **Step 1: Write a failing manifest/build test**

Add a Vitest test that loads the VitePWA configuration and asserts name `7S巡检`, short name `7S巡检`, display `standalone`, theme color `#146b4f`, start URL, and192/512/maskable icons. Run it before adding the plugin and verify failure.

- [ ] **Step 2: Configure PWA caching and update behavior**

Add `VitePWA` with `registerType: "prompt"`. Precache the application shell and static item template, but never cache generated Word files or runtime photo blobs. Display a non-blocking `发现新版本` bar with `立即更新`; do not reload while an unsaved image is being processed.

Generate stable bitmap icons with a white field, green rail/check motif, and the text `7S`; verify icons remain legible at48px. Do not use the China Railway logo or other official marks without supplied authorization.

- [ ] **Step 3: Configure Playwright mobile projects**

`playwright.config.ts` must run Chromium at360x800 and412x915, start `pnpm dev --host 127.0.0.1`, retain traces on failure, and save screenshots only on failure.

Write end-to-end coverage for:

1. create draft from one route;
2. import80 fixture photos across multiple groups;
3. classify at least one group in each category;
4. add one reward and one assessment;
5. split one photo to another category;
6. reload and resume the draft;
7. review and generate Word;
8. inspect the downloaded DOCX ZIP for80 media entries.

- [ ] **Step 4: Add offline resume test**

Load the app once online, create a draft, set browser context offline, reload, and assert the app shell and draft remain usable. Restore online mode before test teardown. The test must not depend on any API server.

- [ ] **Step 5: Add static deployment workflow**

Set `base: "./"` in `vite.config.ts` so static assets work from a repository subpath. Create `.github/workflows/deploy-pages.yml` with:

```yaml
name: Deploy 7S PWA

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.9.0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: app/pnpm-lock.yaml
      - run: pnpm --dir app install --frozen-lockfile
      - run: pnpm --dir app test:run
      - run: pnpm --dir app lint
      - run: pnpm --dir app build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: app/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

The workflow uploads only `app/dist`; it does not upload source `.docx` files or user data.

- [ ] **Step 6: Run complete automated verification**

Run:

```powershell
pnpm --dir app test:run
pnpm --dir app lint
pnpm --dir app build
pnpm --dir app test:e2e
```

Expected: every command exits0; both mobile viewport projects pass; no test has unhandled console errors; DOCX export contains every fixture photo.

- [ ] **Step 7: Perform visual and real-device acceptance**

Complete `docs/field-acceptance.md` with checked evidence for:

- Android Chrome rear-camera launch;
- album multi-select;
-100-photo processing without data loss;
- readable thumbnails and no overlapping controls at360px and412px;
- add-to-home-screen and standalone launch;
- offline draft resume;
- Word open/edit in Android WPS, Windows WPS, and Microsoft Word;
- two- and three-photo row layouts;
- Chinese title, filename, names, amounts, organization, date, and annex;
- backup export, database clear in test profile, and full restore.

Do not mark field acceptance complete until the actual user phone has passed camera, storage, Word, and backup checks.

- [ ] **Step 8: Commit release-ready first version**

Run:

```powershell
git add .github app docs/field-acceptance.md
git commit -m "feat: deliver installable 7s inspection pwa"
git status --short
```

Expected: final commit succeeds and `git status --short` is empty except for intentionally ignored original Word source files.

## Final Verification Gate

Before declaring the implementation complete:

```powershell
pnpm --dir app test:run
pnpm --dir app lint
pnpm --dir app build
pnpm --dir app test:e2e
git log --oneline -12
git status --short
```

Required evidence:

- Unit and component tests pass.
- Both mobile Playwright projects pass.
- The100-photo generator test finds exactly100 media files.
- No report-readiness validation can be bypassed.
- Backup corruption cannot overwrite local data.
- Field acceptance records the actual Android and WPS/Word results.
- All original user documents remain unchanged.
