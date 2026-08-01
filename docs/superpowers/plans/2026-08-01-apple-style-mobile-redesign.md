# Apple 风格移动端改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** 在不改变离线数据、照片处理、Word 生成和 Android 原生能力的前提下，将 7S 巡检应用改造成以 Android 手机现场巡检为优先的 Apple 风格移动端工作工具。

**Architecture:** 保留现有 React 页面和 repository 边界，在 \`app/src/ui/\` 增加少量无数据依赖的视觉组件；用统一 token 和全局 CSS 改造 AppShell、分组列表、底部操作栏和弹层。页面组件只负责从现有 repository 读取数据并组合 UI，不把数据库逻辑下沉到通用组件。

**Tech Stack:** React 19、TypeScript、Vite、React Router、Lucide、Dexie/IndexedDB、Vitest、Testing Library、Playwright、Capacitor Android。

## Global Constraints

- 第一优先级是 Android 手机现场巡检，桌面端保持可用和基本适配。
- 保留 React、Vite、Capacitor、Lucide、IndexedDB、照片处理和 Word 生成；不引入完整第三方移动端组件库。
- 不调整数据库模型、检查项数据、照片持久化、报告生成或 Android 原生相册备份逻辑。
- 所有主要控件最小触控区域为 44px，并计算 \`env(safe-area-inset-bottom)\`。
- 390px、430px 手机宽度不得横向溢出；768px 及以上宽度限制内容最大宽度。
- 状态必须同时使用语义颜色、图标和文字表达，不能只靠颜色区分。
- 每个任务先补针对性测试，再实现，再运行该任务的局部验证命令并提交。

---

## File Map

### Create

- \`app/src/ui/GroupedList.tsx\`：无数据依赖的分组列表、分组标题和列表行。
- \`app/src/ui/ProgressCard.tsx\`：首页巡检进度摘要卡片。
- \`app/src/ui/SegmentedControl.tsx\`：键盘可用、带 roving focus 的分段控制。
- \`app/src/ui/BottomActionBar.tsx\`：带安全区的固定底部操作栏。
- \`app/src/ui/BottomSheet.tsx\`：统一弹层容器、关闭语义和焦点返回。
- \`app/src/ui/ui-components.test.tsx\`：上述公共 UI 的行为和可访问性测试。
- \`app/src/features/dashboard/dashboardSummary.ts\`：从 \`InspectionGraph[]\` 计算首页进度和最近记录的纯函数。
- \`app/src/features/dashboard/dashboardSummary.test.ts\`：首页摘要计算测试。
- \`app/src/features/dashboard/DashboardPage.test.tsx\`：首页异步加载、继续巡检和备份提醒测试。

### Modify

- \`app/src/styles/tokens.css\`：颜色、字体、间距、圆角、阴影和触控 token。
- \`app/src/styles/global.css\`：全局壳层、分组列表、按钮、输入控件、底部操作栏、弹层和响应式样式。
- \`app/src/app/AppShell.tsx\`、\`app/src/app/AppShell.test.tsx\`：顶部导航、底部 Tab、安全区和导航断言。
- \`app/src/features/dashboard/DashboardPage.tsx\`：进度卡片、最近记录和分组操作。
- \`app/src/features/inspections/NewInspectionPage.tsx\`：分组路线选择、模板弹层和底部开始操作。
- \`app/src/features/inspections/ChecklistRouteList.tsx\`、\`CustomRouteDialog.tsx\`：路线行和 Bottom Sheet。
- \`app/src/features/inspections/InspectionPage.tsx\`：巡检进度、分段过滤和底部拍照主操作。
- \`app/src/features/inspections/InspectionEntryEditor.tsx\`、\`InspectionCheckContentEditor.tsx\`：项点编辑和照片次级操作。
- \`app/src/features/inspections/inspection-flow.test.tsx\`、\`InspectionEntryEditor.test.tsx\`：巡检过滤、拍照入口和现有保存行为。
- \`app/src/features/review/ReviewPage.tsx\`、\`ReviewGroupList.tsx\`：摘要条、照片分类分段控制、照片网格和 Word 操作。
- \`app/src/features/review/ReviewRouteSortDialog.tsx\`、\`ReviewRouteEditDialog.tsx\`：底部弹层视觉和焦点行为。
- \`app/src/features/review/ReviewPage.test.tsx\`：复核分段控制、生成操作和错误定位断言。
- \`app/src/features/history/HistoryPage.tsx\`、\`app/src/features/items/ItemLibraryPage.tsx\`、\`app/src/features/settings/SettingsPage.tsx\`、\`BackupPage.tsx\`：次要页面分组列表视觉，不改变 repository 调用。
- \`app/src/features/history/history.test.tsx\`、\`app/src/features/settings/BackupPage.test.tsx\`：历史和备份行为回归测试。

---

## Task 1: Build Shared Mobile UI Primitives and AppShell

**Files:**

- Create: \`app/src/ui/GroupedList.tsx\`
- Create: \`app/src/ui/ProgressCard.tsx\`
- Create: \`app/src/ui/SegmentedControl.tsx\`
- Create: \`app/src/ui/BottomActionBar.tsx\`
- Create: \`app/src/ui/BottomSheet.tsx\`
- Create: \`app/src/ui/ui-components.test.tsx\`
- Modify: \`app/src/styles/tokens.css\`
- Modify: \`app/src/styles/global.css\`
- Modify: \`app/src/app/AppShell.tsx\`
- Test: \`app/src/app/AppShell.test.tsx\`

**Interfaces:**

~~~tsx
export interface GroupedRowProps {
  title: React.ReactNode;
  detail?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export interface ProgressCardProps {
  label: string;
  completed: number;
  total: number;
  actionLabel?: string;
  onAction?: () => void;
}

export interface SegmentedControlOption<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export interface BottomActionBarProps {
  summary?: React.ReactNode;
  children: React.ReactNode;
}
~~~

- [ ] **Step 1: Write failing primitive tests.** Assert that \`GroupedRow\` renders a button when \`onClick\` is supplied, \`ProgressCard\` exposes a bounded completion percentage, \`SegmentedControl\` exposes one \`role="tab"\` with \`tabIndex="0"\`, and \`BottomActionBar\` includes safe-area class names.

~~~tsx
test("renders a grouped row as an accessible action", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(<GroupedRow title="继续巡检" detail="还有 6 个项点" onClick={onClick} />);
  await user.click(screen.getByRole("button", { name: /继续巡检/ }));
  expect(onClick).toHaveBeenCalledOnce();
});

test("keeps segmented control focusable with one active tab", () => {
  render(<SegmentedControl value="all" options={[{ id: "all", label: "全部" }]} onChange={() => undefined} />);
  expect(screen.getByRole("tab", { name: "全部" })).toHaveAttribute("tabindex", "0");
});
~~~

- [ ] **Step 2: Run focused tests and confirm failure.**

Run from \`C:\\Users\\xj\\Desktop\\7s管理\\app\`:

~~~text
pnpm exec vitest run src/ui/ui-components.test.tsx --maxWorkers=1
~~~

Expected: FAIL because the new UI modules do not exist.

- [ ] **Step 3: Implement primitives and token layer.** Export the interfaces above, render semantic \`section\`, \`ul\`, \`li\`, \`button\` and \`role="tablist"\` elements, and add these token values without removing existing semantic aliases:

~~~css
:root {
  --color-canvas: #f2f2f7;
  --color-surface: #ffffff;
  --color-ink: #1c1c1e;
  --color-muted: #8e8e93;
  --color-border: #d9d9de;
  --color-accent: #28795a;
  --radius-group: 14px;
  --radius-control: 11px;
  --space-page: 16px;
  --tap-size: 44px;
}
~~~

Keep \`--color-good\`, \`--color-reminder\`, and \`--color-assessment\`. \`BottomActionBar\` must use \`padding-bottom: calc(8px + env(safe-area-inset-bottom))\`.

- [ ] **Step 4: Update AppShell and run focused tests.** Keep the existing five routes and active-path predicates. Replace the active top border with icon/text tint and keep \`aria-current="page"\` only on the active link.

~~~text
pnpm exec vitest run src/ui/ui-components.test.tsx src/app/AppShell.test.tsx --maxWorkers=1
~~~

Expected: PASS with existing navigation assertions still passing.

- [ ] **Step 5: Commit the shared layer.**

~~~text
git add app/src/ui app/src/styles/tokens.css app/src/styles/global.css app/src/app/AppShell.tsx app/src/app/AppShell.test.tsx
git commit -m "feat: add mobile grouped UI primitives"
~~~

## Task 2: Redesign Dashboard and New Inspection Entry

**Files:**

- Create: \`app/src/features/dashboard/dashboardSummary.ts\`
- Create: \`app/src/features/dashboard/dashboardSummary.test.ts\`
- Create: \`app/src/features/dashboard/DashboardPage.test.tsx\`
- Modify: \`app/src/features/dashboard/DashboardPage.tsx\`
- Modify: \`app/src/features/inspections/NewInspectionPage.tsx\`
- Modify: \`app/src/features/inspections/ChecklistRouteList.tsx\`
- Modify: \`app/src/features/inspections/CustomRouteDialog.tsx\`
- Test: \`app/src/features/inspections/route-selection.test.tsx\`
- Test: \`app/src/features/inspections/inspection-flow.test.tsx\`

**Interfaces:**

~~~ts
export interface DashboardSummary {
  total: number;
  completed: number;
  percentage: number;
  active: InspectionGraph | null;
  recent: InspectionGraph[];
}

export function summarizeDashboard(graphs: readonly InspectionGraph[]): DashboardSummary;
~~~

- [ ] **Step 1: Write summary tests.** Cover an empty graph list, one draft, one reviewed graph, generated graphs, and the rule that recent graphs are limited to three items in repository order.

~~~ts
import type { InspectionGraph, InspectionStatus } from "../../domain/models";

function graphWithStatus(id: string, status: InspectionStatus): InspectionGraph {
  return { inspection: makeInspection({ id, status }), groups: [], photos: [] };
}

test("summarizes current inspection progress without mutating graphs", () => {
  const draft = graphWithStatus("draft", "draft");
  const generated = graphWithStatus("generated", "generated");
  expect(summarizeDashboard([draft, generated])).toMatchObject({
    total: 2,
    completed: 1,
    percentage: 50,
    active: draft,
    recent: [draft, generated],
  });
});
~~~

- [ ] **Step 2: Run summary test and confirm failure.**

~~~text
pnpm exec vitest run src/features/dashboard/dashboardSummary.test.ts --maxWorkers=1
~~~

Expected: FAIL because \`dashboardSummary.ts\` is not implemented.

- [ ] **Step 3: Implement summary and Dashboard loading.** Read \`inspectionRepository.listGraphs(false)\` and \`backupRepository.readBackupReminder()\` in one guarded effect. Keep the existing reminder dismissal call unchanged. Render \`ProgressCard\`, a first grouped row linking to the active draft, grouped “开始新的巡检/本地数据备份” rows, and up to three recent rows using the existing history route.

- [ ] **Step 4: Update new inspection markup without changing selection behavior.** Keep \`selectedTemplateId\`, \`selectedItemIds\`, \`startInspection\`, \`toggleItem\`, and \`addCustomRoute\` unchanged. Replace only layout classes with grouped sections, use \`BottomSheet\` through \`CustomRouteDialog\`, and render \`BottomActionBar\` around the existing \`startInspection\` button. Keep the native \`select\` as the accessible template fallback.

- [ ] **Step 5: Add and run page tests.** Assert the dashboard shows the active draft, progress percentage and backup reminder; assert selecting all routes, clearing all routes, adding a custom route and starting an inspection still use the same repository calls.

~~~text
pnpm exec vitest run src/features/dashboard src/features/inspections/route-selection.test.tsx src/features/inspections/inspection-flow.test.tsx --maxWorkers=1
~~~

Expected: PASS with no changes to persisted inspection graph shape.

- [ ] **Step 6: Commit the dashboard and entry flow.**

~~~text
git add app/src/features/dashboard app/src/features/inspections/NewInspectionPage.tsx app/src/features/inspections/ChecklistRouteList.tsx app/src/features/inspections/CustomRouteDialog.tsx
git commit -m "feat: redesign dashboard and inspection entry"
~~~

## Task 3: Redesign Active Inspection and Photo Capture

**Files:**

- Modify: \`app/src/features/inspections/InspectionPage.tsx\`
- Modify: \`app/src/features/inspections/InspectionEntryEditor.tsx\`
- Modify: \`app/src/features/inspections/InspectionCheckContentEditor.tsx\`
- Modify: \`app/src/features/inspections/inspection-flow.test.tsx\`
- Modify: \`app/src/features/inspections/InspectionEntryEditor.test.tsx\`
- Modify: \`app/src/styles/global.css\`

**Interfaces:**

~~~tsx
type InspectionFilter = "all" | "incomplete" | "complete";

const filterOptions: SegmentedControlOption<InspectionFilter>[] = [
  { id: "all", label: "全部" },
  { id: "incomplete", label: "未完成" },
  { id: "complete", label: "已完成" },
];
~~~

- [ ] **Step 1: Write behavior tests.** Render a graph with one completed and one incomplete entry, select \`未完成\`, and expect only the incomplete entry. Also assert the camera action remains named \`拍摄现场照片\` and calls the existing file input path.

~~~tsx
test("filters active inspection entries without changing the graph", async () => {
  const user = userEvent.setup();
  renderInspectionWithGraph({ completedEntries: ["entry-1"], incompleteEntries: ["entry-2"] });
  await user.click(screen.getByRole("tab", { name: "未完成" }));
  expect(screen.getByText("entry-2 item title")).toBeVisible();
  expect(screen.queryByText("entry-1 item title")).not.toBeInTheDocument();
});
~~~

- [ ] **Step 2: Run targeted tests and confirm the new selector assertion fails.**

~~~text
pnpm exec vitest run src/features/inspections/inspection-flow.test.tsx src/features/inspections/InspectionEntryEditor.test.tsx --maxWorkers=1
~~~

Expected: existing tests pass or fail only at the new \`role="tab"\` assertion.

- [ ] **Step 3: Implement UI-only filter state.** Derive \`InspectionFilter\` from existing \`graph\`, \`groups\`, and \`photos\`; do not add it to \`InspectionGraph\`. Apply \`SegmentedControl\` above the route list, preserve search behavior, and filter rendered entries only. Keep photo processing, retry, delete, split, annotation and gallery backup calls unchanged.

- [ ] **Step 4: Move camera action to \`BottomActionBar\`.** Keep hidden file inputs and callbacks in \`InspectionEntryEditor\`; expose the existing camera input through a prominent button with \`aria-label="拍摄现场照片"\`. Keep replace, retake, delete, annotation and high-quality controls inside the photo group as secondary actions.

- [ ] **Step 5: Run active inspection tests and inspect mobile layout.**

~~~text
pnpm exec vitest run src/features/inspections/inspection-flow.test.tsx src/features/inspections/InspectionEntryEditor.test.tsx src/features/inspections/inspection-check-content-editor.test.tsx --maxWorkers=1
~~~

Expected: PASS; photo persistence, gallery backup errors, retry, annotation and route navigation remain unchanged. Check 390px and 430px screenshots for no bottom-bar overlap.

- [ ] **Step 6: Commit the active inspection surface.**

~~~text
git add app/src/features/inspections/InspectionPage.tsx app/src/features/inspections/InspectionEntryEditor.tsx app/src/features/inspections/InspectionCheckContentEditor.tsx app/src/features/inspections/inspection-flow.test.tsx app/src/features/inspections/InspectionEntryEditor.test.tsx app/src/styles/global.css
git commit -m "feat: refine active inspection mobile workflow"
~~~

## Task 4: Redesign Review and Secondary Pages

**Files:**

- Modify: \`app/src/features/review/ReviewPage.tsx\`
- Modify: \`app/src/features/review/ReviewGroupList.tsx\`
- Modify: \`app/src/features/review/ReviewRouteSortDialog.tsx\`
- Modify: \`app/src/features/review/ReviewRouteEditDialog.tsx\`
- Modify: \`app/src/features/history/HistoryPage.tsx\`
- Modify: \`app/src/features/items/ItemLibraryPage.tsx\`
- Modify: \`app/src/features/settings/SettingsPage.tsx\`
- Modify: \`app/src/features/settings/BackupPage.tsx\`
- Modify: \`app/src/features/review/ReviewPage.test.tsx\`
- Modify: \`app/src/features/history/history.test.tsx\`
- Modify: \`app/src/features/settings/BackupPage.test.tsx\`
- Modify: \`app/src/styles/global.css\`

**Interfaces:**

~~~tsx
const reviewCategories = [
  { id: "good", label: "较好" },
  { id: "reminder", label: "提醒" },
  { id: "assessment", label: "考核" },
] as const satisfies readonly SegmentedControlOption<PhotoCategory>[];
~~~

- [ ] **Step 1: Extend review tests before markup changes.** Preserve existing assertions for generated Word, assessment validation, one-photo-one-category, roving Tab focus, template selection, drag reorder and route navigation. Add an assertion that the three category controls render through shared \`SegmentedControl\` while retaining \`role="tab"\`, \`aria-selected\`, \`aria-controls\`, and \`role="tabpanel"\`.

- [ ] **Step 2: Run review and secondary page tests.**

~~~text
pnpm exec vitest run src/features/review/ReviewPage.test.tsx src/features/history/history.test.tsx src/features/settings/BackupPage.test.tsx --maxWorkers=1
~~~

Expected: existing behavior passes before visual markup changes.

- [ ] **Step 3: Implement review layout.** Use \`SegmentedControl\` for \`good/reminder/assessment\`, keep \`activeCategory\` as local UI state, keep \`ReviewGroupList\` drag callbacks and save queue unchanged, and place Word generation in \`BottomActionBar\`. Keep existing error focus targets and status messages.

- [ ] **Step 4: Convert dialogs and secondary pages to shared surfaces.** Wrap existing sort/edit dialogs with \`BottomSheet\`, keep save/cancel callbacks, and replace only layout classes in history, items, settings and backup pages with \`GroupedSection\`/\`GroupedRow\`. Do not change repository calls, route paths, or backup serialization.

- [ ] **Step 5: Run focused tests and responsive checks.**

~~~text
pnpm exec vitest run src/features/review/ReviewPage.test.tsx src/features/history/history.test.tsx src/features/settings/BackupPage.test.tsx --maxWorkers=1
~~~

Expected: PASS; generated report, share, download, validation focus, drag reorder, trash/restore, and backup import/export retain previous behavior.

- [ ] **Step 6: Commit review and secondary pages.**

~~~text
git add app/src/features/review app/src/features/history app/src/features/items app/src/features/settings app/src/styles/global.css
git commit -m "feat: apply grouped mobile surfaces to review and settings"
~~~

## Task 5: Full Verification and Android Packaging Check

**Files:**

- Verify: \`app/src/**\`
- Verify: \`app/android/**\`
- Verify: \`docs/superpowers/specs/2026-08-01-apple-style-mobile-redesign-design.md\`

- [ ] **Step 1: Run full tests serially.** From \`C:\\Users\\xj\\Desktop\\7s管理\\app\` run:

~~~text
pnpm exec vitest run --maxWorkers=1
~~~

Expected: all test files and test cases pass. Use serial mode because the repository already records resource contention with parallel photo/Excel/UI tests.

- [ ] **Step 2: Run lint and web build.**

~~~text
pnpm lint
pnpm build
~~~

Expected: both pass; a Vite chunk-size warning alone is not a failure if the command exits successfully.

- [ ] **Step 3: Run browser responsive checks.** Start the Vite app on an unused port and capture home, new inspection, active inspection and review at 390px, 430px and 768px. Verify no \`scrollWidth > clientWidth\`, no fixed action obscures the last list row, and active navigation has \`aria-current\` or \`aria-selected\` as appropriate.

- [ ] **Step 4: Build the Android debug APK.** From \`C:\\Users\\xj\\Desktop\\7s管理\\app\\android\` with existing JDK 21 and Android SDK paths run:

~~~text
./gradlew.bat assembleDebug
~~~

Expected: successful debug APK build with no Java source or Capacitor plugin changes.

- [ ] **Step 5: Inspect final diff.**

~~~text
git status --short --branch
git diff --check origin/main..HEAD
~~~

Expected: only planned UI, test and documentation files are changed; no \`output/\`, source Word files, \`AGENTS.md\`, or local assets are staged.

## Self-Review

- Spec coverage: token and shell requirements are covered by Task 1; home and entry flow by Task 2; active inspection and capture by Task 3; review and secondary pages by Task 4; responsive, accessibility, test, build and APK requirements by Task 5.
- Placeholder scan: every step names concrete files, commands, interfaces and expected outcomes; no incomplete requirement remains.
- Type consistency: \`SegmentedControlOption<T>\` is defined in Task 1 and reused with \`InspectionFilter\` in Task 3 and \`PhotoCategory\` in Task 4; \`ProgressCardProps\`, \`BottomActionBarProps\`, and \`DashboardSummary\` are defined before their consumers.
- Data boundary: all tasks preserve existing repository calls and keep new UI state local to pages; no task modifies \`InspectionGraph\` or IndexedDB schema.
