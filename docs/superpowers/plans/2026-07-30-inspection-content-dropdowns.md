# 巡检检查内容下拉选择与 Word 正文简化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在每个巡检区域中提供 4 组可自定义的检查内容下拉选择，并让 Word 正文使用所选短句且完全取消附表。

**Architecture:** 新建独立领域模块集中维护菜单、校验、排序和正文格式化；`InspectionEntry` 保存本次巡检选择，仓库使用小范围 Dexie 事务更新单条巡检条目。巡检页通过独立编辑组件保存选择，报告模型按条目选择生成正文，DOCX 生成器只负责正文和照片，不再构建附表。

**Tech Stack:** React 19、TypeScript 6、Dexie 4、Zod 4、docx 9、Vitest 4、Playwright。

## Global Constraints

- 固定类别顺序必须为“环境卫生、物品定置、设备清洁保养、安全防护”。
- 每个类别最多选择一条；4 个类别可同时选择；默认全部未选择。
- 固定菜单文字必须与设计文档逐字一致，不得加入“关机断电”。
- 选择“自定义”时只保存当前巡检当前区域，且自定义值去除首尾空格后不能为空。
- 照片分类只决定 Word 章节，不自动改写所选短句。
- Word 不输出附表，不增加“7S管理落实较好”“本次予以提醒”等自动话术。
- 未选择内容的旧巡检继续使用现有照片组说明。
- 不修改 `checklistItems`、`routeTemplates` 或整改追踪规则。
- 不修改三份原始 DOCX 文件。
- 本项目不使用 Git，不执行 commit、branch、worktree 或 reset 命令。

---

### Task 1: 检查内容领域模型与兼容解析

**Files:**
- Create: `app/src/domain/inspectionCheckContents.ts`
- Create: `app/src/domain/inspectionCheckContents.test.ts`
- Modify: `app/src/domain/models.ts`
- Modify: `app/src/domain/schemas.ts`
- Modify: `app/src/domain/inspection.ts`
- Modify: `app/src/test/fixtures.ts`

**Interfaces:**
- Produces: `InspectionCheckCategory`、`InspectionCheckSelection`。
- Produces: `INSPECTION_CHECK_DEFINITIONS`。
- Produces: `normalizeInspectionCheckSelections(value)`、`formatInspectionCheckSummary(value, separator)`。
- Changes: `InspectionEntry.checkSelections: InspectionCheckSelection[]`。

- [ ] **Step 1: 写领域行为失败测试**

在 `inspectionCheckContents.test.ts` 覆盖：

```ts
expect(INSPECTION_CHECK_DEFINITIONS).toEqual([
  { category: "environment", label: "环境卫生", options: ["干净整洁", "基本整洁", "清扫不到位", "存在积灰杂物"] },
  { category: "placement", label: "物品定置", options: ["规范有序", "基本规范", "个别物品未定置", "摆放杂乱"] },
  { category: "equipment", label: "设备清洁保养", options: ["清洁保养良好", "表面无积灰油污", "清洁保养不到位", "存在积灰油污"] },
  { category: "safety", label: "安全防护", options: ["防护措施齐全", "消防设施状态良好", "安全通道畅通", "存在安全隐患"] },
]);
```

测试固定值、自定义值、无序输入按固定顺序归一化，并断言：

```ts
expect(formatInspectionCheckSummary(selections, "，")).toBe(
  "环境卫生干净整洁，物品定置规范有序",
);
```

另测重复类别、未知类别、固定值不属于菜单、空自定义值被拒绝；空数组合法。

- [ ] **Step 2: 运行领域测试确认 RED**

Run: `pnpm test:run src/domain/inspectionCheckContents.test.ts`

Expected: FAIL，因为模块和类型尚不存在。

- [ ] **Step 3: 定义类型和纯领域函数**

在 `models.ts` 增加：

```ts
export type InspectionCheckCategory = "environment" | "placement" | "equipment" | "safety";

export interface InspectionCheckSelection {
  category: InspectionCheckCategory;
  value: string;
  isCustom: boolean;
}

export interface InspectionEntry {
  // existing fields
  checkSelections: InspectionCheckSelection[];
}
```

在新模块中声明只读菜单，建立类别排名映射，并实现：

```ts
export function normalizeInspectionCheckSelections(
  selections: readonly InspectionCheckSelection[],
): InspectionCheckSelection[];

export function formatInspectionCheckSummary(
  selections: readonly InspectionCheckSelection[],
  separator?: "、" | "，",
): string;
```

归一化必须 trim `value`、拒绝重复类别、校验固定值并按菜单顺序返回新数组。格式化先调用归一化，再拼接 `定义.label + selection.value`。

- [ ] **Step 4: 扩展 Zod 解析并兼容旧数据**

在 `schemas.ts` 增加类别和选择 schema：

```ts
export const inspectionCheckCategorySchema = z.enum([
  "environment", "placement", "equipment", "safety",
]);

export const inspectionCheckSelectionSchema = z.object({
  category: inspectionCheckCategorySchema,
  value: z.string(),
  isCustom: z.boolean(),
});
```

把 `inspectionEntrySchema` 的字段定义为：

```ts
checkSelections: z.array(inspectionCheckSelectionSchema).default([]),
```

Schema 解析后仍必须经过领域归一化验证，不能只依赖结构校验。

- [ ] **Step 5: 所有新条目初始化为空选择**

在 `createInspectionEntry` 返回值和测试夹具中加入：

```ts
checkSelections: [],
```

扩展 `inspection.test.ts`，断言固定项和临时项创建后均为空数组。

- [ ] **Step 6: 运行领域与创建测试确认 GREEN**

Run: `pnpm test:run src/domain/inspectionCheckContents.test.ts src/domain/inspection.test.ts`

Expected: PASS，零失败。

### Task 2: 单条巡检事务、备份版本 3 与历史复制

**Files:**
- Modify: `app/src/db/inspectionRepository.ts`
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/db/repositories.test.ts`
- Modify: `app/src/db/backupRepository.ts`
- Modify: `app/src/db/backupRepository.test.ts`
- Modify: `app/src/features/history/HistoryPage.tsx`
- Modify: `app/src/features/history/history.test.tsx`

**Interfaces:**
- Consumes: `normalizeInspectionCheckSelections`。
- Produces: `InspectionCheckSelectionUpdateResult`。
- Produces: `InspectionRepository.updateEntryCheckSelections(...)`。

- [ ] **Step 1: 写仓库事务失败测试**

新增接口期望：

```ts
interface InspectionCheckSelectionUpdateResult {
  entry: InspectionEntry;
  updatedAt: string;
}

updateEntryCheckSelections(
  inspectionId: string,
  entryId: string,
  selections: readonly InspectionCheckSelection[],
  updatedAt?: string,
): Promise<InspectionCheckSelectionUpdateResult>;
```

测试成功更新只改变目标 entry 的 `checkSelections`、巡检 `status` 为 `draft` 和 `updatedAt`。预置的其他条目、照片组、照片、项点库和路线模板必须 deep-equal 不变。

分别覆盖：巡检不存在或已删除、条目不存在、条目属于其他巡检、无效选择、强制巡检更新时间失败时回滚。并发测试要求该更新与 `addPhotoToGoodGroup` 同时执行后，选择和照片组引用均保留。

- [ ] **Step 2: 运行仓库测试确认 RED**

Run: `pnpm test:run src/db/repositories.test.ts`

Expected: FAIL，因为仓库方法不存在。

- [ ] **Step 3: 实现小范围 Dexie 事务并接入依赖端口**

事务只声明 `inspections` 和 `entries`：

```ts
return this.db.transaction("rw", this.db.inspections, this.db.entries, async () => {
  const inspection = await this.db.inspections.get(inspectionId);
  if (!inspection || inspection.deletedAt !== null) throw new GraphIntegrityError("巡检记录不存在或已删除。");
  const entry = await this.db.entries.get(entryId);
  if (!entry || entry.inspectionId !== inspectionId) throw new GraphIntegrityError("巡检条目不存在或归属不一致。");
  const normalized = normalizeInspectionCheckSelections(selections);
  const storedEntry = { ...entry, checkSelections: normalized };
  await this.db.entries.put(storedEntry);
  const changed = await this.db.inspections.update(inspectionId, { status: "draft", updatedAt });
  if (changed !== 1) throw new GraphIntegrityError("巡检记录更新失败。");
  return { entry: storedEntry, updatedAt };
});
```

在 `InspectionRepositoryPort` 和 `createAppDependencies` 中使用完全相同的签名转发。

同时在 `readGraphFromDb` 读取 entries 后立即归一化旧记录，保证升级前已存在的 IndexedDB 数据不产生 `undefined`：

```ts
const normalizedEntries = entries.map((entry) => ({
  ...entry,
  checkSelections: normalizeInspectionCheckSelections(entry.checkSelections ?? []),
}));
```

`getGraph`、`listGraphs`、报告快照和后续页面状态必须统一使用 `normalizedEntries`。

- [ ] **Step 4: 运行仓库测试确认 GREEN**

Run: `pnpm test:run src/db/repositories.test.ts`

Expected: PASS。

- [ ] **Step 5: 写备份版本与兼容失败测试**

新增测试要求：

- 新备份 manifest 为 `schemaVersion: 3`，选择数组完整保存。
- 版本 3 的 replace/merge 恢复保留固定和自定义选择。
- 版本 1、2 条目没有字段时恢复为空数组。
- 重复类别、无效固定值、空自定义值的版本 3 备份被拒绝。
- 旧版本备份如果非法夹带无效选择也不能绕过校验。

- [ ] **Step 6: 实现备份版本 3**

把当前写出版本改为 `3 as const`，新增与版本 2 相同文件集合的 `ManifestV3`。`BackupPreview.schemaVersion` 扩为 `1 | 2 | 3`，读取仍接受 1、2。解析 entries 后统一执行：

```ts
entry.checkSelections = normalizeInspectionCheckSelections(entry.checkSelections ?? []);
```

创建备份时始终写出规范化后的版本 3 条目，避免旧应用静默丢弃新字段。

- [ ] **Step 7: 运行备份测试确认 GREEN**

Run: `pnpm test:run src/db/backupRepository.test.ts`

Expected: PASS。

- [ ] **Step 8: 历史复制明确清空选择**

在 `copiedItems` 或创建新巡检入口明确依赖 `createInspectionEntry` 生成 `checkSelections: []`，不得把历史条目选择映射进新巡检。扩展历史测试：源记录有选择，复制后普通条目仍存在但选择为空，随后 `createBackup()` 成功。

- [ ] **Step 9: 运行仓库、备份和历史测试**

Run: `pnpm test:run src/db/repositories.test.ts src/db/backupRepository.test.ts src/features/history/history.test.tsx`

Expected: PASS。

### Task 3: 巡检页面四组下拉编辑器

**Files:**
- Create: `app/src/features/inspections/InspectionCheckContentEditor.tsx`
- Create: `app/src/features/inspections/inspection-check-content-editor.test.tsx`
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Modify: `app/src/features/inspections/inspection-flow.test.tsx`
- Modify: `app/src/styles/global.css`

**Interfaces:**
- Consumes: `INSPECTION_CHECK_DEFINITIONS`、`formatInspectionCheckSummary`。
- Consumes: `inspectionRepository.updateEntryCheckSelections(...)`。
- Produces component:

```ts
interface InspectionCheckContentEditorProps {
  entry: InspectionEntry;
  disabled: boolean;
  onSave(selections: InspectionCheckSelection[]): Promise<void>;
}
```

- [ ] **Step 1: 写独立编辑器失败测试**

覆盖以下交互：

- 空值折叠按钮名称为“检查内容：请选择检查内容”。
- 展开后有 4 个 combobox，标签逐字为四个类别。
- 每个 combobox 包含“未选择”、4 个固定值和“自定义”。
- 选择环境卫生“干净整洁”和物品定置“规范有序”后确定，`onSave` 收到固定顺序数组。
- 选择“自定义”后仅该行出现输入框；空输入不能确定；输入“地沟未清扫”后保存 `isCustom: true`。
- 取消恢复展开前状态；清空全部选择可保存空数组。
- deferred 保存期间禁用下拉、输入、确定、取消和折叠按钮，双击只调用一次。
- 保存拒绝后保持展开、保留值、显示错误并聚焦失败行或第一个可操作控件。

- [ ] **Step 2: 运行组件测试确认 RED**

Run: `pnpm test:run src/features/inspections/inspection-check-content-editor.test.tsx`

Expected: FAIL，因为组件不存在。

- [ ] **Step 3: 实现独立编辑器**

组件内部保存已提交快照和草稿。下拉值使用固定 option 文本和内部哨兵 `__custom__`；该哨兵不得写入仓库。确定时构造：

```ts
const selections = INSPECTION_CHECK_DEFINITIONS.flatMap((definition) => {
  const draft = drafts[definition.category];
  if (!draft.mode) return [];
  return [{
    category: definition.category,
    value: draft.mode === "custom" ? draft.customValue.trim() : draft.mode,
    isCustom: draft.mode === "custom",
  }];
});
```

折叠摘要用顿号连接，Word 使用的中文逗号由报告模型负责。

- [ ] **Step 4: 运行组件测试确认 GREEN**

Run: `pnpm test:run src/features/inspections/inspection-check-content-editor.test.tsx`

Expected: PASS。

- [ ] **Step 5: 写巡检页集成失败测试**

用真实测试数据库创建草稿，打开环境卫生和物品定置下拉并保存。断言：

- 页面静态“检查某区域7S管理落实情况”被新控件替代。
- 仓库记录包含选择，摘要立即显示。
- 刷新路由后选择仍存在。
- 搜索“干净整洁”可以找到该条目。
- 仓库拒绝时页面保留编辑器值。
- 页面切换到其他巡检后，旧保存结果不会写入当前页面状态。

- [ ] **Step 6: 集成到 InspectionPage**

在 `matchesSearch` 中加入格式化摘要。新增按 entry ID 记录保存中的状态；保存函数捕获当前 inspection ID 和 generation，调用仓库后仅在当前巡检仍一致时函数式替换目标 entry：

```ts
setGraph((current) => current?.inspection.id === inspectionId ? {
  ...current,
  inspection: {
    ...current.inspection,
    status: "draft",
    updatedAt: result.updatedAt,
    entries: current.inspection.entries.map((entry) =>
      entry.id === result.entry.id ? result.entry : entry),
  },
} : current);
```

用 `InspectionCheckContentEditor` 替换 `<p>{entry.itemSnapshot.standard}</p>`。照片处理中显示摘要但禁用打开/保存。

- [ ] **Step 7: 添加移动端样式**

为 `.inspection-check-editor`、`__summary`、`__panel`、`__row`、`__custom` 和 `__actions` 添加样式。桌面每行使用 `minmax(8rem, auto) minmax(0, 1fr)`，`max-width: 420px` 改为单列；文本使用 `overflow-wrap: anywhere`，按钮和 select 最小高度 44px。不得创建卡片嵌套。

- [ ] **Step 8: 运行页面回归**

Run: `pnpm test:run src/features/inspections/inspection-check-content-editor.test.tsx src/features/inspections/inspection-flow.test.tsx src/features/inspections/route-selection.test.tsx`

Expected: PASS。

### Task 4: Word 正文短句与附表移除

**Files:**
- Modify: `app/src/features/reports/reportModel.ts`
- Modify: `app/src/features/reports/reportModel.test.ts`
- Modify: `app/src/features/reports/generateDocx.ts`
- Modify: `app/src/features/reports/generateDocx.test.ts`

**Interfaces:**
- Consumes: `formatInspectionCheckSummary(selections, "，")`。
- Removes: `ReportAnnexRow` 和 `ReportModel.annexRows`。
- Removes: DOCX `annexCell`、`annexValues`、`annexTable` 及相关 imports。

- [ ] **Step 1: 写报告模型失败测试**

构造同一 entry 的固定和自定义选择：

```ts
checkSelections: [
  { category: "environment", value: "干净整洁", isCustom: false },
  { category: "placement", value: "规范有序", isCustom: false },
  { category: "safety", value: "消防器材缺失", isCustom: true },
]
```

断言 good、reminder、assessment 三类 group 的 `text` 均以以下正文为基础，仅奖励/考核后缀不同：

```text
卷扬机间：环境卫生干净整洁，物品定置规范有序，安全防护消防器材缺失。
```

另测空选择仍使用 `group.description`；无照片条目不进入正文；模型不再暴露 `annexRows`。

- [ ] **Step 2: 运行报告模型测试确认 RED**

Run: `pnpm test:run src/features/reports/reportModel.test.ts`

Expected: FAIL，因为模型仍使用照片组通用说明并包含附表数据。

- [ ] **Step 3: 修改报告模型**

在构建 group 时读取 entry：

```ts
const selectedText = formatInspectionCheckSummary(entry.checkSelections ?? [], "，");
const baseText = selectedText
  ? `${entry.itemSnapshot.routeName}：${selectedText}。`
  : group.description;
text: `${baseText}${evaluationSuffix(category, group.awardAssessment)}`;
```

如果 group 关联 entry 不存在，继续抛出完整性错误。删除 `ReportAnnexRow`、`annexRows` 生成和返回字段。

- [ ] **Step 4: 运行报告模型测试确认 GREEN**

Run: `pnpm test:run src/features/reports/reportModel.test.ts`

Expected: PASS。

- [ ] **Step 5: 把 DOCX 附表测试改为“不存在”测试**

删除原“附表列宽”断言，新增：

```ts
expect(documentXml).not.toContain("附件：巡检照片明细表");
expect(documentXml).not.toContain("责任工班");
expect(documentXml).not.toContain("区域设备");
```

同时断言正文短句和照片 drawing 仍存在。

- [ ] **Step 6: 从 DOCX 生成器删除附表代码**

删除附表三个 helper、相关类型导入和 `children.push` 中的附件标题与 `annexTable(model)`。保留正文、closingText、组织名称和日期，确保签名日期成为文档最后内容。

- [ ] **Step 7: 运行 Word 测试确认 GREEN**

Run: `pnpm test:run src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts`

Expected: PASS。

### Task 5: 移动端流程与完整交付验证

**Files:**
- Modify: `app/tests/e2e/inspection-flow.spec.ts`
- Modify: `app/tests/e2e/word-export.spec.ts`
- Verify: all modified files and original DOCX hashes.

**Interfaces:**
- Consumes: completed inspection dropdown and Word export flows.

- [ ] **Step 1: 增加移动端下拉 E2E**

在 360x800 与 412x915 两个项目中：新建巡检、展开第一条检查内容、选择“环境卫生/干净整洁”和“物品定置/自定义”，输入“工具摆放整齐”，确定，断言摘要显示且页面无横向溢出。刷新后断言选择保留，再导入测试照片并进入复核。

- [ ] **Step 2: 扩展 Word E2E**

生成 Word 后读取 `word/document.xml`，断言包含：

```text
卷扬机间：环境卫生干净整洁，物品定置工具摆放整齐。
```

并断言不包含“附件：巡检照片明细表”“责任工班”表头和旧通用短句。

- [ ] **Step 3: 运行聚焦测试两次**

Run twice:

`pnpm test:run src/domain/inspectionCheckContents.test.ts src/domain/inspection.test.ts src/db/repositories.test.ts src/db/backupRepository.test.ts src/features/history/history.test.tsx src/features/inspections/inspection-check-content-editor.test.tsx src/features/inspections/inspection-flow.test.tsx src/features/reports/reportModel.test.ts src/features/reports/generateDocx.test.ts`

Expected: 两次均零失败。

- [ ] **Step 4: 运行完整单元、压力和提取测试**

Run:

```powershell
pnpm test:run
pnpm test:stress
pnpm test:extract-default-items
```

Expected: 全部退出码 0。

- [ ] **Step 5: 运行静态和生产检查**

Run:

```powershell
pnpm lint
pnpm build
```

Expected: 全部退出码 0，无 lint、类型或构建错误。

- [ ] **Step 6: 运行完整浏览器回归**

Run:

```powershell
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e
```

Expected: 两个手机视口全部通过。

- [ ] **Step 7: 验证原始文件哈希**

用 `Get-FileHash -Algorithm SHA256` 验证：

```text
向塘钢轨焊接整修7S管理考核办法.docx        14047FF931183E967F58B0B8E93A06DFCA8CF4D0D5B01FB52D9B965E018C252E
向塘钢轨焊接整修车间7月21日7S巡检通报.docx 9B2B8EF4027AEDA626C10A48C4B2850B46304BE73181573A0879005ED15BF144
向塘钢轨焊接整修车间7月23日7S巡检通报.docx 22939F5A7FB34B474BD200A0ACD45B6F58149EF35DD5F0826DC420E642C340DA
```

- [ ] **Step 8: 重建并重启预览**

在可用端口运行 `pnpm exec vite preview --host 0.0.0.0`，实际保存固定值和自定义值，刷新确认保留；生成 Word 后确认正文短句正确且没有附表。
