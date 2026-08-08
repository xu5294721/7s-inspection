# 7S 巡检 Apple 风格视觉系统与 APK 图标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有功能、路由、数据模型和业务分类的前提下，将 7S 巡检应用统一为“清透 iOS + 现场绿”视觉系统，并替换 APK、PWA、favicon 和启动页图标。

**Architecture:** 沿用现有 React、React Router、Lucide 和全局 CSS class 体系，优先通过 `tokens.css` 与 `global.css` 统一基础视觉，再按现有页面边界调整视觉包裹和状态 class。图标使用一份批准的“轨道勾”源资产生成 Android adaptive icon、各密度图标和 PWA 图标，不新增业务组件或数据层。

**Tech Stack:** React 19, TypeScript, Vite, Capacitor 8, Lucide React, Vitest, Testing Library, Playwright, `@capacitor/assets`, Android Gradle。

## Global Constraints

- 现有路由、底部导航、巡检流程、评价类别、拍照与相册、通报复核、Word 生成、历史记录、模板设置和备份恢复功能均保持不变。
- 不新增页面、新导航入口、新业务分类、新统计指标或云端能力。
- 不更换 React、Vite、Capacitor 或 Lucide 技术栈。
- 不引入外部在线字体、重型 UI 组件库或会影响离线使用的网络资源。
- 主色建议为 `#087456`，画布为 `#f2f2f7`，表面为 `#ffffff`，主文字为 `#1c1c1e`，辅助文字为 `#8e8e93`，分隔线为 `#d1d1d6`。
- 普通输入框和按钮使用 10～12px 圆角，分组容器和照片区域使用 14～16px 圆角，Bottom Sheet 顶部使用 24px 圆角。
- 所有主要交互区域最小 44px，并适配 `env(safe-area-inset-bottom)`。
- 现有评价类别和业务标签的数量、文字、数据结构保持原样。
- 图标主体必须在 48px、72px 和 108px 预览尺寸下清晰可识别。

---

## File Map

### Shared visual foundation

- Modify: `app/src/styles/tokens.css` — 颜色、字体、圆角、间距和触控令牌。
- Modify: `app/src/styles/global.css` — 页面壳层、按钮、输入框、分组列表、导航、固定操作栏、弹层和状态提示。

### Shell and page surfaces

- Modify: `app/src/app/AppShell.test.tsx` — 保证导航数量、标签、活动状态和子路由活动状态不回退。
- Modify: `app/src/features/dashboard/DashboardPage.tsx` — 仅调整首页主操作与备份提醒的视觉包裹。
- Modify: `app/src/features/inspections/NewInspectionPage.tsx` — 仅调整模板、路线和底部操作栏的视觉包裹。
- Modify: `app/src/features/inspections/InspectionPage.tsx` — 仅调整巡检页层级、状态和底部操作视觉。
- Modify: `app/src/features/inspections/InspectionItemSheet.tsx` — 统一项点编辑 Bottom Sheet 的视觉结构。
- Modify: `app/src/features/inspections/InspectionEntrySummary.tsx` — 统一项点行的完成状态和摘要展示。
- Modify: `app/src/features/photos/PhotoCaptureButtons.tsx` — 保留拍照/相册行为，统一按钮视觉。
- Modify: `app/src/features/photos/PhotoGroupEditor.tsx` — 保留评价与照片编辑行为，统一分类、照片和操作样式。
- Modify: `app/src/features/photos/PhotoAnnotationDialog.tsx` — 统一照片标注弹层。

### Review and secondary pages

- Modify: `app/src/features/review/ReviewPage.tsx` — 保留复核、排序和 Word 生成行为，统一摘要、标签和底部操作区。
- Modify: `app/src/features/review/ReviewGroupList.tsx` — 保留拖动排序，统一照片组表面和操作按钮。
- Modify: `app/src/features/review/ReviewRouteEditDialog.tsx` — 统一项点编辑弹层。
- Modify: `app/src/features/review/ReviewRouteSortDialog.tsx` — 统一排序弹层。
- Modify: `app/src/features/history/HistoryPage.tsx` — 统一筛选、历史行和操作按钮。
- Modify: `app/src/features/history/TrashPage.tsx` — 统一回收站和危险确认弹层。
- Modify: `app/src/features/items/ItemLibraryPage.tsx` — 统一项点库、导入预览和操作按钮。
- Modify: `app/src/features/items/ItemEditor.tsx` — 统一项点编辑表单。
- Modify: `app/src/features/settings/SettingsPage.tsx` — 统一设置入口 grouped list。
- Modify: `app/src/features/settings/BackupPage.tsx` — 统一备份、恢复、存储状态和危险操作。
- Modify: `app/src/features/settings/InspectionCheckTemplatePage.tsx` — 统一检查内容模板表单。
- Modify: `app/src/features/settings/TemplateSettingsPage.tsx` — 统一 Word 模板表单和保存操作。

### Icon assets and verification

- Replace: `app/resources/icon-only.png` — 1024x1024 “轨道勾”源图标。
- Replace/generated: `app/public/icons/icon-192.png` — PWA 图标。
- Replace/generated: `app/public/icons/icon-512.png` — PWA 图标。
- Replace/generated: `app/public/icons/icon-maskable-512.png` — PWA maskable 图标。
- Replace: `app/public/favicon.svg` — 与“轨道勾”一致的浏览器图标。
- Generated: `app/android/app/src/main/res/mipmap-*/*` — Android 各密度图标。
- Generated/modified: `app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` — adaptive icon 配置。
- Generated/modified: `app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml` — round adaptive icon 配置。
- Modify: `app/playwright.config.ts` — 增加 390、430 和 768 宽度的视觉回归视口。
- Create: `app/tests/e2e/visual-shell.spec.ts` — 检查关键页面的溢出、安全区和导航固定布局。

---

## Task 1: Replace visual tokens and global primitive styles

**Files:**
- Modify: `app/src/styles/tokens.css`
- Modify: `app/src/styles/global.css`

**Interfaces:**
- Consumes: Existing semantic classes such as `.page-section`, `.primary-action`, `.secondary-action`, `.bottom-nav`, `.page-command-bar`, `.search-control`, `.inspection-item-sheet`, `.review-tabs`, `.settings-link`.
- Produces: A shared token contract that every existing page can use without changing business logic.

- [ ] **Step 1: Replace the root token block**

Update `app/src/styles/tokens.css` so the root variables are exactly based on this contract while preserving `color-scheme: light` and the existing `--tap-size` variable:

```css
:root {
  color-scheme: light;
  --color-ink: #1c1c1e;
  --color-muted: #8e8e93;
  --color-surface: #ffffff;
  --color-canvas: #f2f2f7;
  --color-border: #d1d1d6;
  --color-accent: #087456;
  --color-good: #2f855a;
  --color-reminder: #b7791f;
  --color-assessment: #b23a3a;
  --radius-control: 12px;
  --radius-group: 16px;
  --radius-sheet: 24px;
  --tap-size: 44px;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}
```

- [ ] **Step 2: Normalize global primitive selectors**

In `app/src/styles/global.css`, update the base body, headings, controls, focus rings and shared button rules so that:

- `body` uses `var(--color-canvas)`.
- Inputs, selects and textareas use `var(--color-surface)`, `var(--color-ink)`, `var(--color-border)` and `var(--radius-control)`.
- Focus rings remain visible and use a 3px outline with `var(--color-reminder)`.
- Primary buttons use `var(--color-accent)` and secondary buttons use white surfaces with accent text.
- No shared rule uses a hard-coded old green, old border color or 6px control radius.

- [ ] **Step 3: Remove border stacking from ordinary lists**

Update the shared list rules so grouped lists use one outer grouping surface, lightweight separators and consistent vertical spacing. Do not remove existing selectors that are used by tests; use modifier classes for each new visual state.

- [ ] **Step 4: Run the fast static checks**

Run from `C:\Users\xj\Desktop\7s管理\app`:

```powershell
pnpm lint
pnpm build
```

Expected: both commands exit with code 0. A build or lint failure at this stage must be fixed before continuing because every later page relies on these selectors.

- [ ] **Step 5: Commit the shared foundation**

```powershell
git add app/src/styles/tokens.css app/src/styles/global.css
git commit -m "style: establish Apple visual tokens"
```

## Task 2: Restyle AppShell, bottom navigation, dashboard and route selection

**Files:**
- Modify: `app/src/app/AppShell.test.tsx`
- Modify: `app/src/features/dashboard/DashboardPage.tsx`
- Modify: `app/src/features/inspections/NewInspectionPage.tsx`
- Modify: `app/src/styles/global.css`

**Interfaces:**
- Consumes: The token contract from Task 1 and the existing five `navigation` entries in `AppShell.tsx`.
- Produces: A stable shell with the same five navigation links and a grouped route-selection surface.

- [ ] **Step 1: Freeze the existing AppShell contract**

Do not change `app/src/app/AppShell.tsx`. The existing `navigation` array, link targets, labels, `aria-current` behavior and active-path functions already provide the required styling hooks. The resulting navigation must still contain exactly these five labels:

```ts
["首页", "巡检", "历史", "项点", "设置"]
```

- [ ] **Step 2: Write the navigation regression assertions**

Extend `app/src/app/AppShell.test.tsx` with assertions equivalent to:

```tsx
expect(screen.getAllByRole("link")).toHaveLength(5);
expect(screen.getByRole("link", { name: "历史" })).toHaveAttribute("aria-current", "page");
expect(screen.getByRole("link", { name: "历史" })).toHaveClass("bottom-nav__item", "is-active");
```

Keep the existing subroute test for `/history/trash` and `/settings/templates`.

- [ ] **Step 3: Restyle topbar and bottom navigation**

Use a white or translucent-white topbar and a bottom navigation surface with safe-area padding. Replace the active top border with a small icon/text color change and a low-contrast rounded active background. Preserve `position: fixed`, link semantics and the five-column layout.

- [ ] **Step 4: Restyle the dashboard without adding dashboard data**

Keep `开始巡检`, the backup reminder, dismissal behavior and `/settings/backup` link. Style `.dashboard-action` as the single primary action surface and `.backup-reminder` as a pale amber status strip. Do not add progress cards, recent records, new counts or new links.

- [ ] **Step 5: Restyle new-inspection route selection**

Keep template selection, route selection, select-all, clear-all, custom-route dialog and start action. Use grouped rows, circular selection states and a safe-area-aware `.page-command-bar`. Do not change the selected ID set or the save/creation callbacks.

- [ ] **Step 6: Run focused shell and route tests**

Run:

```powershell
pnpm exec vitest run src/app/AppShell.test.tsx src/features/inspections/route-selection.test.tsx
```

Expected: all tests pass with zero failures.

- [ ] **Step 7: Commit the shell and route-selection pass**

```powershell
git add app/src/app/AppShell.test.tsx app/src/features/dashboard/DashboardPage.tsx app/src/features/inspections/NewInspectionPage.tsx app/src/styles/global.css
git commit -m "style: refine app shell and route selection"
```

## Task 3: Restyle the active inspection and photo-editing flow

**Files:**
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Modify: `app/src/features/inspections/InspectionItemSheet.tsx`
- Modify: `app/src/features/inspections/InspectionEntrySummary.tsx`
- Modify: `app/src/features/photos/PhotoCaptureButtons.tsx`
- Modify: `app/src/features/photos/PhotoGroupEditor.tsx`
- Modify: `app/src/features/photos/PhotoAnnotationDialog.tsx`
- Modify: `app/src/styles/global.css`
- Test: `app/src/features/inspections/inspection-flow.test.tsx`
- Test: `app/src/features/inspections/photo-import.test.tsx`
- Test: `app/src/features/photos/PhotoGroupEditor.test.tsx`

**Interfaces:**
- Consumes: Existing `InspectionGraph`, photo processing signal, `InspectionItemSheet` callbacks and `PhotoGroupEditor` save/split callbacks.
- Produces: The same inspection and photo operations with a grouped-list hierarchy and iOS-like sheets.

- [ ] **Step 1: Add regression assertions before visual edits**

Confirm the existing focused tests cover these unchanged behaviors; add assertions only where a visual wrapper would otherwise risk changing semantics:

```tsx
expect(screen.getByRole("button", { name: "拍照" })).toBeVisible();
expect(screen.getByRole("button", { name: "从相册选择" })).toBeVisible();
expect(screen.getByRole("button", { name: "完成本项" })).toBeVisible();
```

Use the actual accessible names already exposed by the components when adding assertions.

- [ ] **Step 2: Refine route, area and entry hierarchy**

Keep all existing route grouping, search filtering, complete-state calculation, photo counts and entry click handlers. Use the existing classes to create:

- a quiet page background;
- a grouped route surface;
- lightweight area separators;
- a completed entry indicator using icon plus text;
- a compact secondary context line.

- [ ] **Step 3: Refine the item Bottom Sheet**

Keep the existing `role="dialog"`, close behavior, focus return, `暂存并关闭` and `完成本项` callbacks. Do not add a new interaction handle or gesture; use the existing header structure and apply a 24px top radius, a strong header/body/footer separation and safe-area footer padding.

- [ ] **Step 4: Refine photo capture and thumbnails**

Keep camera input, gallery input, retry, gallery synchronization and processing progress unchanged. Make camera and gallery buttons equal in size and hierarchy. Use 12～14px rounded thumbnails with compact icon actions instead of nested bordered cards.

- [ ] **Step 5: Refine evaluation and annotation states**

Keep the existing evaluation categories, description editing, reward/assessment fields, split-photo behavior and annotation dialog. Use semantic status tokens only for selected segments, labels, inline warnings and assessment fields.

- [ ] **Step 6: Run the focused inspection and photo tests**

```powershell
pnpm exec vitest run src/features/inspections/inspection-flow.test.tsx src/features/inspections/photo-import.test.tsx src/features/photos/PhotoGroupEditor.test.tsx
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 7: Commit the active inspection pass**

```powershell
git add app/src/features/inspections/InspectionPage.tsx app/src/features/inspections/InspectionItemSheet.tsx app/src/features/inspections/InspectionEntrySummary.tsx app/src/features/photos/PhotoCaptureButtons.tsx app/src/features/photos/PhotoGroupEditor.tsx app/src/features/photos/PhotoAnnotationDialog.tsx app/src/features/inspections/inspection-flow.test.tsx app/src/features/inspections/photo-import.test.tsx app/src/features/photos/PhotoGroupEditor.test.tsx app/src/styles/global.css
git commit -m "style: refine active inspection surfaces"
```

## Task 4: Restyle review, sorting and Word-generation actions

**Files:**
- Modify: `app/src/features/review/ReviewPage.tsx`
- Modify: `app/src/features/review/ReviewGroupList.tsx`
- Modify: `app/src/features/review/ReviewRouteEditDialog.tsx`
- Modify: `app/src/features/review/ReviewRouteSortDialog.tsx`
- Modify: `app/src/styles/global.css`
- Test: `app/src/features/review/ReviewPage.test.tsx`
- Test: `app/src/features/review/ReviewDnd.test.tsx`
- Test: `app/src/features/review/ReviewRouteSortDialog.test.tsx`

**Interfaces:**
- Consumes: Existing review category state, drag-and-drop handlers, report validation, template selection and report generation callbacks.
- Produces: A review page with grouped summaries, lightweight category tabs and a safe-area-aware Word action area.

- [ ] **Step 1: Preserve review behavior with focused assertions**

Keep tests for category switching, group/photo reorder, validation error focus, template selection and Word generation. Add an assertion that the main action remains named `生成Word` and that generated-report actions remain `分享Word` and `下载Word`.

- [ ] **Step 2: Convert summary and category controls to one visual system**

Keep the current summary values and current category count. Style `.review-summary` as a light summary strip and `.review-tabs` as a segmented control. Use selected-state color and text weight without changing tab roles or keyboard behavior.

- [ ] **Step 3: Refine photo groups and assessment fields**

Keep drag handles, photo order, group description, assessment people and amount fields. Reduce nested borders, use one group surface and place secondary actions in compact icon buttons with accessible labels.

- [ ] **Step 4: Refine validation and Word command area**

Keep validation messages and focus-to-error behavior. Make `生成Word` the only filled primary action, with sharing and download as secondary actions after generation. Ensure the command area clears the bottom navigation height and safe-area inset.

- [ ] **Step 5: Run focused review tests**

```powershell
pnpm exec vitest run src/features/review/ReviewPage.test.tsx src/features/review/ReviewDnd.test.tsx src/features/review/ReviewRouteSortDialog.test.tsx
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 6: Commit the review pass**

```powershell
git add app/src/features/review/ReviewPage.tsx app/src/features/review/ReviewGroupList.tsx app/src/features/review/ReviewRouteEditDialog.tsx app/src/features/review/ReviewRouteSortDialog.tsx app/src/features/review/ReviewPage.test.tsx app/src/features/review/ReviewDnd.test.tsx app/src/features/review/ReviewRouteSortDialog.test.tsx app/src/styles/global.css
git commit -m "style: refine report review surfaces"
```

## Task 5: Restyle history, item library, settings and backup surfaces

**Files:**
- Modify: `app/src/features/history/HistoryPage.tsx`
- Modify: `app/src/features/history/TrashPage.tsx`
- Modify: `app/src/features/items/ItemLibraryPage.tsx`
- Modify: `app/src/features/items/ItemEditor.tsx`
- Modify: `app/src/features/settings/SettingsPage.tsx`
- Modify: `app/src/features/settings/BackupPage.tsx`
- Modify: `app/src/features/settings/InspectionCheckTemplatePage.tsx`
- Modify: `app/src/features/settings/TemplateSettingsPage.tsx`
- Modify: `app/src/styles/global.css`
- Test: Existing focused tests for history, backup, templates and item library.

**Interfaces:**
- Consumes: Existing filters, import preview, edit/disable actions, backup/recovery actions and template save behavior.
- Produces: Consistent grouped lists, forms, status banners and confirmation surfaces without changing action handlers.

- [ ] **Step 1: Restyle settings entry list**

Keep the three existing settings links and their text. Use a leading icon container, title, description and a right-side chevron-style visual affordance. Do not add an account, sync or cloud section.

- [ ] **Step 2: Restyle history and trash lists**

Keep date/text/category filters, resume/open/copy/delete/regenerate actions, trash navigation and permanent-delete confirmation. Use grouped rows and reduce action button border weight. Keep dangerous actions red only at the action level.

- [ ] **Step 3: Restyle item library and import preview**

Keep Excel import, preview counts, error table, edit and disable actions. Use a grouped table/list surface with clear section headings and preserve all existing accessible labels.

- [ ] **Step 4: Restyle forms and backup status**

Keep every current form field, template version behavior, backup export/restore behavior, storage metrics and warnings. Group related fields into white sections and use unified input heights, labels and inline status banners.

- [ ] **Step 5: Run the existing secondary-page tests**

Run from `app`:

```powershell
pnpm exec vitest run src/features/history/history.test.tsx src/features/settings/BackupPage.test.tsx src/features/settings/inspection-check-template.test.tsx src/features/settings/template-settings.test.tsx src/features/items/item-library.test.tsx
```

Expected: all five listed test files pass with zero failures.

- [ ] **Step 6: Commit the secondary-page pass**

```powershell
git add app/src/features/history app/src/features/items app/src/features/settings app/src/styles/global.css
git commit -m "style: unify history settings and library surfaces"
```

## Task 6: Create and distribute the “轨道勾” icon asset

**Files:**
- Replace: `app/resources/icon-only.png`
- Replace/generated: `app/public/icons/icon-192.png`
- Replace/generated: `app/public/icons/icon-512.png`
- Replace/generated: `app/public/icons/icon-maskable-512.png`
- Replace: `app/public/favicon.svg`
- Generated: `app/android/app/src/main/res/mipmap-*/*`
- Generated/modified: `app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Generated/modified: `app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`

**Interfaces:**
- Consumes: Approved “轨道勾” visual direction from `docs/superpowers/specs/2026-08-08-apple-visual-system-and-app-icon-design.md`.
- Produces: One consistent icon family for Android, PWA, browser tab and launch surface.

- [ ] **Step 1: Create the 1024x1024 source asset**

Create a real raster source at `app/resources/icon-only.png` with a deep-green rounded-square background and a white rounded-line motif: two simplified horizontal rails crossed by an ascending check line. Do not place “7S” text in the foreground. Keep the motif within 58%～68% of the canvas width and leave enough transparent foreground margin for Android adaptive-icon cropping.

- [ ] **Step 2: Generate Android and PWA derivatives**

From `app`, run:

```powershell
pnpm exec capacitor-assets generate --android --pwa
```

Expected: Android mipmap assets, adaptive icon XML, PWA PNG assets and any configured splash assets are regenerated from the approved source without changing the application ID.

- [ ] **Step 3: Align favicon and launch background**

Update `app/public/favicon.svg` to use the same simplified motif and update only the launch background/foreground asset needed to keep the same icon identity. Do not add text or a second logo system.

- [ ] **Step 4: Inspect the icon at required sizes**

Open the generated source and representative Android/PWA derivatives at 48px, 72px and 108px. Confirm the rails and check remain visually connected, the motif is not clipped by round masking and the white foreground has sufficient contrast against the green background.

- [ ] **Step 5: Commit the icon family**

```powershell
git add app/resources app/public/icons app/public/favicon.svg app/android/app/src/main/res
git commit -m "style: refresh inspection app icon family"
```

## Task 7: Add responsive visual regression coverage

**Files:**
- Modify: `app/playwright.config.ts`
- Create: `app/tests/e2e/visual-shell.spec.ts`

**Interfaces:**
- Consumes: Existing Playwright fixtures and routes from `app/tests/e2e`.
- Produces: Repeatable checks for mobile safe areas, no horizontal overflow and stable navigation/action placement.

- [ ] **Step 1: Add the required viewport projects**

Keep the existing Chromium settings and add projects for 390x844, 430x932 and 768x1024. The project list should include these exact viewport declarations:

```ts
{ name: "mobile-390", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
{ name: "mobile-430", use: { browserName: "chromium", viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true } },
{ name: "tablet-768", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: false } },
```

Do not remove the existing 360 and 412 projects until the new visual checks have passed on the current suite.

- [ ] **Step 2: Add the visual-shell test**

Create `app/tests/e2e/visual-shell.spec.ts` using the existing fixture setup. The test must open the app, assert the five navigation labels, assert that the document width does not exceed the viewport, and verify that the bottom navigation is visible. Use this complete assertion pattern:

```ts
import { expect, test } from "@playwright/test";

test("keeps the Apple shell inside the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "首页" })).toBeVisible();
  await expect(page.getByRole("link", { name: "巡检" })).toBeVisible();
  await expect(page.getByRole("link", { name: "历史" })).toBeVisible();
  await expect(page.getByRole("link", { name: "项点" })).toBeVisible();
  await expect(page.getByRole("link", { name: "设置" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
```

- [ ] **Step 3: Add key-page navigation checks**

Extend the test or add focused tests for `/settings`, `/history` and `/inspections/new` to confirm that the page command bar or bottom navigation remains visible and no fixed control extends past the viewport width.

- [ ] **Step 4: Run the visual checks**

Run:

```powershell
pnpm test:e2e
```

Expected: existing functional E2E tests and the new visual-shell checks pass for all configured projects. Any screenshot review must be done at 390x844, 430x932 and 768x1024.

- [ ] **Step 5: Commit the responsive verification pass**

```powershell
git add app/playwright.config.ts app/tests/e2e/visual-shell.spec.ts
git commit -m "test: verify Apple shell responsive layout"
```

## Task 8: Run the full regression and Android build checks

**Files:**
- No source changes expected; inspect the complete commit range from Tasks 1–7.
- Output: a debug APK under the existing Android build output path; generated APKs are verification artifacts and are not committed.

**Interfaces:**
- Consumes: All visual, page and icon changes from Tasks 1–7.
- Produces: Evidence that visual-only changes did not break the offline inspection workflow or Android packaging.

- [ ] **Step 1: Run the full Vitest suite single-worker**

From `app`:

```powershell
pnpm exec vitest run --maxWorkers=1
```

Expected: exit code 0 and zero failed tests.

- [ ] **Step 2: Run lint and production build**

```powershell
pnpm lint
pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Run Playwright E2E**

```powershell
pnpm test:e2e
```

Expected: all configured viewport projects pass with zero failed tests.

- [ ] **Step 4: Build Android debug APK**

From `app/android` with the project JDK 21 environment:

```powershell
.\gradlew.bat assembleDebug
```

Expected: Gradle reports `BUILD SUCCESSFUL` and produces the debug APK under the existing Android build output path.

- [ ] **Step 5: Verify the no-function-change boundary**

Review the final diff and confirm it contains only styling, visual wrappers, icon assets, tests and test configuration. Confirm no route table, repository, domain model, report generator, photo persistence or backup behavior was changed.

- [ ] **Step 6: Keep generated verification output out of the commit**

Do not commit `app/output/`, Playwright traces, screenshots, Gradle build directories or other generated verification artifacts unless an existing release workflow explicitly requires a tracked file.

## Self-review checklist

- [ ] The “轨道勾” icon task covers source, Android adaptive icon, round icon, PWA icons, favicon and launch identity.
- [ ] The token task covers the exact colors, font stack, radius hierarchy, tap size and safe-area rule from the approved spec.
- [ ] The shell task preserves exactly five existing navigation entries and does not add dashboard features.
- [ ] The inspection task preserves camera, gallery, retry, annotation, evaluation, save and completion behavior.
- [ ] The review task preserves category switching, drag-and-drop, validation, Word generation, share and download behavior.
- [ ] The secondary-page task preserves history, item import, template settings and backup/restore behavior.
- [ ] The responsive task covers 390px, 430px and 768px visual checks and retains existing viewport coverage.
- [ ] The final task runs full Vitest, lint, build, Playwright and Android debug packaging verification.
- [ ] The plan contains no unresolved placeholders or unspecified implementation decisions.
