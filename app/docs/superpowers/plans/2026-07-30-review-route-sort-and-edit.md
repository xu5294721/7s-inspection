# 通报复核项点排序与编辑实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让通报复核可按巡检项点标题整体排序，并可在复核页弹窗内编辑该项点的检查内容、照片和评价。

**Architecture:** 在 `Inspection` 中保存可选的 `reviewRouteOrder` 标题数组，旧巡检以现有项点顺序作为只读回退值。报告模型以该顺序排列每个分类内的照片组。复核页新增排序弹窗与项点编辑弹窗；项点编辑器从检查页提取为可复用组件，保证两处使用相同的照片和评价保存逻辑。

**Tech Stack:** React 19, TypeScript 6, Dexie 4, dnd-kit 10, Vitest 4, Playwright。

## Global Constraints

- 排序对象是 `routeName` 标题；同一标题下的全部照片组作为整体移动。
- Word 继续使用“好的方面、提醒问题、考核问题”三个章节，仅改变每个章节内部的项点顺序。
- 没有照片的标题不显示在排序弹窗，不进入 Word。
- `reviewRouteOrder` 对旧巡检是可选字段；缺失字段必须继续可读取、可生成 Word。
- 编辑弹窗必须支持检查内容、拍照/相册、评价、分类、奖考、照片排序、标注、替换、重拍和删除。
- 不新增附表、整改追踪、云同步或 APK 打包工作。
- 手工文件修改使用 `apply_patch`；项目当前没有可用于提交的历史基线，不创建 Git 提交。

---

### Task 1: 持久化项点标题排序并保持旧数据兼容

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/domain/schemas.ts`
- Modify: `src/domain/inspection.ts`
- Modify: `src/test/fixtures.ts`
- Modify: `src/db/inspectionRepository.ts`
- Modify: `src/db/repositories.test.ts`
- Create: `src/domain/reviewRouteOrder.ts`
- Create: `src/domain/reviewRouteOrder.test.ts`

**Interfaces:**
- `resolveReviewRouteOrder(inspection: Inspection): string[]` 返回去重的完整路线标题顺序；显式保存顺序优先，未出现标题按 `entry.order` 补在末尾。
- `sortRouteNamesForReview(graph: InspectionGraph): string[]` 只返回至少有照片的标题，按解析后的完整排序排列。
- `Inspection.reviewRouteOrder?: string[]` 保持旧 IndexedDB 数据兼容。
- `InspectionRepository.updateReviewRouteOrder(inspectionId: string, routeNames: string[]): Promise<Inspection>` 原子保存标题顺序。

- [ ] **Step 1: 写失败的标题顺序领域测试**

在 `src/domain/reviewRouteOrder.test.ts` 添加：

```ts
test("keeps an explicit route order and appends newly seen titles once", () => {
  const inspection = makeInspection({
    reviewRouteOrder: ["仓库外围院子", "卷扬机间"],
    entries: [
      entryFor("卷扬机间", 0),
      entryFor("装整工班办公室", 1),
      entryFor("仓库外围院子", 2),
    ],
  });
  expect(resolveReviewRouteOrder(inspection)).toEqual([
    "仓库外围院子",
    "卷扬机间",
    "装整工班办公室",
  ]);
});

test("uses entry order for a legacy inspection without reviewRouteOrder", () => {
  const legacy = makeInspection({ entries: [entryFor("乙项点", 1), entryFor("甲项点", 0)] });
  delete (legacy as { reviewRouteOrder?: string[] }).reviewRouteOrder;
  expect(resolveReviewRouteOrder(legacy)).toEqual(["甲项点", "乙项点"]);
});
```

在 `repositories.test.ts` 添加保存、重读和重复标题拒绝测试：`updateReviewRouteOrder("inspection-1", ["仓库外围院子", "卷扬机间"])` 重读后保留该顺序；重复值抛出 `巡检项点排序不能重复。`。

- [ ] **Step 2: 验证 RED**

运行：

```powershell
pnpm test:run src/domain/reviewRouteOrder.test.ts src/db/repositories.test.ts
```

预期：失败，原因是 `reviewRouteOrder`、解析函数和仓储方法尚不存在。

- [ ] **Step 3: 实现兼容字段与排序函数**

在 `Inspection` 和 `inspectionRecordSchema` 加入：

```ts
reviewRouteOrder: z.array(z.string().trim().min(1)).optional(),
```

并在 schema 的 `superRefine` 中拒绝重复标题。`createInspection` 初始化：

```ts
reviewRouteOrder: [...new Set(entries.map((entry) => entry.itemSnapshot.routeName))],
```

`resolveReviewRouteOrder` 以已保存数组为基础，按 `entry.order` 追加不存在的标题；`sortRouteNamesForReview` 使用有照片组的 `entryId` 集合筛选标题。仓储方法必须在同一事务中读取巡检、验证数组与该巡检已有标题一致、更新 `reviewRouteOrder` 和 `updatedAt`，然后返回更新后的巡检。

- [ ] **Step 4: 验证 GREEN**

运行 Step 2 的命令。预期：所有测试通过，旧巡检不需要迁移也能得到稳定排序。

Review checkpoint: 显式标题顺序、旧记录回退、重复值拒绝、未知标题拒绝均有测试。

---

### Task 2: 将标题排序应用到 Word 报告模型

**Files:**
- Modify: `src/features/reports/reportModel.ts`
- Modify: `src/features/reports/reportModel.test.ts`

**Interfaces:**
- `buildReportModel` 对每个照片分类先按项点 `reviewRouteOrder` 排列，再按原有 `group.order` 和 `group.id` 排列。
- 同一标题下的多个分类照片组仍在各自 Word 章节中，且维持同一标题相对顺序。

- [ ] **Step 1: 写失败的报告模型测试**

构造三条已拍照项点：`仓库外围院子`（提醒）、`装整工班办公室`（好）、`卷扬机间`（好和考核），并设置：

```ts
reviewRouteOrder: ["卷扬机间", "仓库外围院子", "装整工班办公室"]
```

断言：

```ts
expect(model.sections.find((section) => section.category === "good")?.groups.map((group) => group.text))
  .toEqual(["卷扬机间…", "装整工班办公室…"]);
expect(model.sections.find((section) => section.category === "reminder")?.groups.map((group) => group.text))
  .toEqual(["仓库外围院子…"]);
expect(model.sections.find((section) => section.category === "assessment")?.groups.map((group) => group.text))
  .toEqual(["卷扬机间…"]);
```

再删除 `reviewRouteOrder`，断言旧记录仍按 `entry.order` 输出。

- [ ] **Step 2: 验证 RED**

运行：

```powershell
pnpm test:run src/features/reports/reportModel.test.ts
```

预期：失败，当前只按 `group.order` 排列。

- [ ] **Step 3: 实现路由排序键**

在 `buildReportModel` 创建：

```ts
const routeRank = new Map(resolveReviewRouteOrder(graph.inspection).map((name, index) => [name, index]));
const groupRouteRank = (group: PhotoGroup) => {
  const entry = entryById.get(group.entryId);
  return entry ? routeRank.get(entry.itemSnapshot.routeName) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
};
```

将分类内排序改为先比较 `groupRouteRank(left) - groupRouteRank(right)`，再保持现有 `order`、`id` 比较。不要调整模板章节排序、分类过滤或 Word 标题生成逻辑。

- [ ] **Step 4: 验证 GREEN**

运行 Step 2 命令。预期：报告模型测试通过，原有 Word 条件章节测试不变。

Review checkpoint: 三个章节仍存在其原有顺序；只改变每个章节内部项点顺序。

---

### Task 3: 提取可复用的单项点编辑器

**Files:**
- Create: `src/features/inspections/InspectionEntryEditor.tsx`
- Create: `src/features/inspections/InspectionEntryEditor.test.tsx`
- Modify: `src/features/inspections/InspectionPage.tsx`
- Modify: `src/features/inspections/inspection-flow.test.tsx`

**Interfaces:**
- `InspectionEntryEditor` 接收 `entry`、关联 `groups`/`photos`、`checklistItem`、处理状态和既有保存回调。
- 组件公开 `onFilesSelected`、`onSaveCheckSelections`、`onSavePhotoGroup`、`onSplit`、`onPhotoSave`、`onDeletePhoto`、`onReplacePhoto`、`onHighQualityChange`，不直接访问 Dexie。
- 检查页和复核编辑弹窗使用同一个组件。

- [ ] **Step 1: 写失败的组件测试**

在新测试文件渲染一个带一张照片的项点编辑器，验证：

```ts
await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "干净整洁");
await user.click(screen.getByRole("button", { name: "确认" }));
expect(onSaveCheckSelections).toHaveBeenCalledWith([
  { category: "environment", value: "干净整洁", isCustom: false },
]);
expect(screen.getByRole("button", { name: "保存评价" })).toBeVisible();
expect(screen.getByLabelText("相册文件")).toBeVisible();
```

- [ ] **Step 2: 验证 RED**

运行：

```powershell
pnpm test:run src/features/inspections/InspectionEntryEditor.test.tsx
```

预期：失败，组件不存在。

- [ ] **Step 3: 提取检查页项点内容**

从 `InspectionPage` 的 `li.inspection-entry` 中提取当前已有的检查内容编辑器、拍照按钮、`PhotoGroupEditor`、缩略图和 `PhotoActions`。新组件只负责单项点展示和回调转发，保留现有 CSS class、aria 标签与照片处理逻辑。

检查页将原来的内联 JSX 替换为：

```tsx
<InspectionEntryEditor
  entry={entry}
  groups={groups}
  photos={graph.photos}
  checklistItem={checklistItem}
  disabled={processing || savingEntryIds.has(entry.id)}
  onFilesSelected={(files) => void processFiles(entry.id, files)}
  onSaveCheckSelections={(selections) => saveEntryCheckSelections(entry.id, selections)}
  onSavePhotoGroup={savePhotoGroup}
  onSplit={(group, photoId, category) => splitGroupPhoto(group, checklistItem, photoId, category)}
  onPhotoSave={savePhotoAnnotation}
  onDeletePhoto={deletePhoto}
  onReplacePhoto={replacePhoto}
  onHighQualityChange={changeHighQuality}
/>
```

- [ ] **Step 4: 验证 GREEN**

运行：

```powershell
pnpm test:run src/features/inspections/InspectionEntryEditor.test.tsx src/features/inspections/inspection-flow.test.tsx
```

预期：编辑器和原检查流程测试通过。

Review checkpoint: 检查页行为、照片质量控制、重拍和标注功能无回归。

---

### Task 4: 增加复核页标题排序弹窗与项点编辑弹窗

**Files:**
- Create: `src/features/review/ReviewRouteSortDialog.tsx`
- Create: `src/features/review/ReviewRouteEditDialog.tsx`
- Modify: `src/features/review/ReviewPage.tsx`
- Modify: `src/features/review/ReviewPage.test.tsx`
- Modify: `src/features/review/ReviewDnd.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- `ReviewRouteSortDialog({ routeNames, onSave, onCancel })` 使用 `DndContext`、`SortableContext` 与键盘/指针传感器，回传完整标题数组。
- `ReviewRouteEditDialog({ routeName, children, onClose })` 为全屏弹窗，关闭后恢复原标题按钮焦点。
- `ReviewPage` 新增 `排序` 按钮和按标题排列的项点摘要；点击标题打开编辑弹窗。

- [ ] **Step 1: 写失败的排序与编辑交互测试**

在 `ReviewPage.test.tsx` 构造 `卷扬机间`、`仓库外围院子` 两个有照片项点，断言：

```ts
await user.click(screen.getByRole("button", { name: "排序" }));
expect(screen.getByRole("dialog", { name: "项点排序" })).toBeVisible();
expect(screen.getAllByRole("button", { name: /拖动项点/ })).toHaveLength(2);

await user.click(screen.getByRole("button", { name: "编辑 仓库外围院子" }));
expect(screen.getByRole("dialog", { name: "编辑 仓库外围院子" })).toBeVisible();
expect(screen.getByRole("button", { name: /检查内容/ })).toBeVisible();
expect(screen.getByLabelText("相册文件")).toBeVisible();
```

在 `ReviewDnd.test.tsx` 模拟标题拖动结束后，断言 `updateReviewRouteOrder` 接收到调整后的数组，复核页分类内容顺序随之刷新。

- [ ] **Step 2: 验证 RED**

运行：

```powershell
pnpm test:run src/features/review/ReviewPage.test.tsx src/features/review/ReviewDnd.test.tsx
```

预期：失败，排序按钮、标题编辑入口和仓储调用不存在。

- [ ] **Step 3: 实现弹窗与复核页状态同步**

`ReviewRouteSortDialog` 将可拖动标题行设为：

```tsx
<button type="button" aria-label={`拖动项点 ${routeName}`} {...sortable.attributes} {...sortable.listeners}>
  <GripVertical aria-hidden="true" size={20} />
</button>
```

拖动结束使用 `arrayMove` 更新本地顺序；点击“保存排序”后调用 `onSave(nextRouteNames)`，保存期间禁用命令。

`ReviewPage` 使用 `sortRouteNamesForReview(graph)` 建立摘要标题列表。保存时乐观更新：

```ts
const next = { ...graph, inspection: { ...graph.inspection, reviewRouteOrder: routeNames } };
void persist(() => inspectionRepository.updateReviewRouteOrder(id, routeNames), next);
```

标题按钮使用 `aria-label={`编辑 ${routeName}`}`。编辑弹窗通过 `InspectionEntryEditor` 渲染该标题的所有 entries；回调复用检查页的仓储方法，并在每次成功写入后从 `inspectionRepository.getGraph(id)` 刷新当前复核图。

在样式中将弹窗设为小屏全屏、可滚动内容区、固定命令区；拖动按钮保留稳定尺寸，不使标题文字缩放或重排。

- [ ] **Step 4: 验证 GREEN**

运行 Step 2 的命令。预期：排序和编辑弹窗测试通过，分类标签数量、错误聚焦和 Word 生成按钮保持现有行为。

Review checkpoint: 只可编辑有照片标题；标题拖动不移动单个照片组；关闭弹窗恢复焦点。

---

### Task 5: 移动端端到端验证与全量验收

**Files:**
- Modify: `tests/e2e/word-export.spec.ts`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- E2E 创建至少三个标题、跨好/提醒/考核三类照片，保存标题排序并编辑其中一个标题。
- 下载 DOCX XML 后验证每个分类内标题对应的评价说明按保存顺序出现。

- [ ] **Step 1: 写失败的移动端 E2E 场景**

在 `word-export.spec.ts`：

1. 创建 `卷扬机间`、`仓库外围院子`、`装整工班办公室` 三个有照片项点；
2. 在复核页打开“排序”，把 `仓库外围院子` 拖到第一位并保存；
3. 打开“编辑 仓库外围院子”，将环境卫生改为“干净整洁”，保存并关闭；
4. 生成 Word；
5. 读取 DOCX XML，断言提醒问题章节中“仓库外围院子”的评价说明位于后续提醒项点之前，并包含修改后的检查内容。

- [ ] **Step 2: 验证 RED**

运行：

```powershell
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm exec playwright test tests/e2e/word-export.spec.ts
```

预期：失败，排序和复核页编辑入口不存在。

- [ ] **Step 3: 完成 E2E 适配并验证 GREEN**

完成 Task 1-4 后运行 Step 2 命令。预期：两个移动端项目均通过，DOCX 保持无附表、空分类省略、标题缩进和自定义标题规则。

- [ ] **Step 4: 全量验证**

运行：

```powershell
pnpm exec tsc -b --pretty false
pnpm lint
pnpm test:run
pnpm build
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e
```

预期：TypeScript、lint、全部 Vitest、生产构建和全部 14 个移动端 E2E 场景通过。

- [ ] **Step 5: 记录验收结果**

在 `.superpowers/sdd/progress.md` 写入每项 focused/full 测试数量与独立审查结论。若 LibreOffice 仍未安装，只说明 DOCX XML 和浏览器导出已验证，不声称完成 Word 页面渲染检查。

Review checkpoint: Word 分类结构、条件标题、现有检查页与移动端离线流程均已回归。
