# 无照片评价组纳入 Word 生成 设计文档

日期：2026-08-06
状态：已批准（用户逐项确认）

## 一、问题背景

当前行为（v1.0.7 起的既有设计）：检查项点时若只选择评价内容（如"环境干净整洁"）而不拍照，该评价组虽然在复核页显示为"已检查"，但生成 Word 时被完全过滤（`buildReportModel` 中 `photographedGroups` 仅保留 `photoIds.length > 0` 的组），导致"界面显示已检查、Word 中却不体现"的不一致。

用户需求：无照片的评价组应以**文字条目**形式纳入 Word 生成。

## 二、需求确认（用户已逐项批准）

1. **呈现形式**：无照片评价作为文字条目插入对应章节（如"1. 卷扬机间：环境卫生干净整洁。"），与有照片项点在同一章节内**连续编号**，该条下方**不生成照片区域**。
2. **最少照片校验**：保留"整份报告至少需要一张已归组照片"（`REPORT_PHOTO_REQUIRED`），纯文字巡检不允许生成 Word。
3. **奖考信息**：无照片条目若填了奖励/考核信息，文字后**同样附加**"（奖励：XX，XX元）"/"（考核：XX，XX元）"，与有照片条目一致。
4. **章节标题**：章节只要有条目（无论有无照片）就生成标题；纯文字章节同样生成标题。
5. **模板章节校验**：无照片组**同样参与**"照片分类不在模板章节中则阻止生成并提示切换模板"的校验（`PHOTO_CATEGORY_NOT_IN_TEMPLATE`），与有照片组一致。

## 三、实现方案（方案 A，用户已确认）

### 3.1 `app/src/features/reports/reportModel.ts`

- `buildReportModel` 中第 116 行 `const photographedGroups = graph.groups.filter((group) => group.photoIds.length > 0);` 改为直接使用全部组（不再按照片过滤）：

```ts
const photographedGroups = graph.groups;
```

（变量名保留 `photographedGroups` 会误导，重命名为 `reportGroups` 或在原处直接使用 `graph.groups`。**决策：重命名为 `reportGroups`**，涉及第 116/118 行两处引用。）

- 无照片组的 `photos` 字段：现有 `group.photoIds.map(...)` 对空数组自然得到 `[]`，无需额外分支。
- 编号逻辑不变：`number: index + 1` 在章节内对全部条目（含无照片）统一编号。
- 排序逻辑不变：路线顺序 → 组 `order` → 组 `id`。
- 奖考附加 `evaluationSuffix` 不变。
- 开头 `if (graph.photos.length === 0) throw new Error("报告至少需要一张已归组照片。");` **保留不动**。
- `formatInspectionEvaluationDescription` 在无照片组同样可用（`entry.checkSelections` 存在）。

### 3.2 `app/src/features/reports/generateDocx.ts`

- 输出循环中，`imageTable` 仅在组内有照片时输出：

```ts
for (const group of section.groups) {
  children.push(bodyParagraph(model, `${group.number}. ${group.text}`, {
    keepNext: true,
    firstLineIndent: true,
  }));
  if (group.photos.length > 0) {
    children.push(imageTable(model, group.photos.map((photo) => {
      const prepared = preparedById.get(photo.id);
      if (!prepared) throw new Error(`照片 ${photo.id} 尚未处理。`);
      return prepared;
    })));
  }
}
```

- `preparedById` 循环（第 260 行 `reportPhotos` 收集）只处理有照片的组，无照片组不参与照片预算/压缩/进度，无需改动。
- `reportModel.ts` 中 `ReportGroup` 接口 `photos: ReportPhoto[]` 天然允许空数组，无需改类型。

### 3.3 `app/src/domain/reportValidation.ts`

- `PHOTO_CATEGORY_NOT_IN_TEMPLATE` 校验（第 132-143 行）当前条件为 `group.photoIds.length > 0 && !templateCategories.has(group.category)`，改为**去掉照片数量条件**：

```ts
if (
  templateCategories &&
  !templateCategories.has(group.category)
) {
  errors.push(error(
    group.id,
    "template.sections",
    "PHOTO_CATEGORY_NOT_IN_TEMPLATE",
    "照片分类不在当前模板章节中，请切换至最新四分类模板。",
  ));
}
```

- 报错文案含"照片"字样，但语义为"分类不在模板中"，沿用现有文案（用户可接受；如需更准确可改为"评价分类不在当前模板章节中"——**决策：文案改为"评价分类不在当前模板章节中，请切换至最新四分类模板。"**，因该校验现在覆盖无照片组）。

### 3.4 测试更新

**修改现有测试：**
- `app/src/features/reports/reportModel.test.ts` 的 `"excludes entries without photos from report body sections"`：改为断言无照片组**被包含**（`model.sections` 中 text 包含"无照片项。"，且该组 `photos` 为空数组）。
- 检查并更新其他依赖"无照片组被排除"行为的测试（grep `photoIds: []`、`no-photo`、`noPhoto` 相关用例）。

**新增测试：**
- `reportModel.test.ts`：
  - 无照片组 `photos: []` 且编号与有照片组连续（如同一章节有照片组 number=1，无照片组 number=2）
  - 纯无照片章节：章节标题仍生成（`sections` 含该分类且 `groups.length > 0`）
  - 无照片组奖考信息附加（good + reward / assessment）
- `reportValidation.test.ts`：
  - 无照片组分类不在模板章节时产生 `PHOTO_CATEGORY_NOT_IN_TEMPLATE`（旧三分类模板 + 无照片"一般表现"组）
- `generateDocx.test.ts`：
  - 无照片组只输出文字段落、无 `<w:drawing>`、无表格（构造 `ReportModel` 直接调用 `generateDocx` 或经 `buildReportModel` 全链路）

### 3.5 边界情况

- 章节内全部为无照片组：章节标题生成、条目为纯文字、无照片区域——正常。
- 整份巡检全无照片：被 `graph.photos.length === 0` 校验拦截，不能生成——符合需求 2。
- 旧三分类模板 + 无照片"一般表现"组：`PHOTO_CATEGORY_NOT_IN_TEMPLATE` 阻止生成，提示切换四分类模板——符合需求 5。
- 无照片组不参与照片压缩预算（`getDocxPhotoBudget` 按 `reportPhotos` 计算，只含有照片组）——正确。

## 四、不做的事（YAGNI）

- 不改 `ReportGroup` 接口（不加 `hasPhotos` 标记，`photos.length` 已足够）。
- 不改数据库结构、不改备份格式、不改模板结构。
- 不做"纯文字报告允许生成"（用户明确保留最少照片校验）。
- 不做 Word 中无照片条目的特殊样式（与有照片条目同款式文字行）。

## 五、验证

- 全量测试（`pnpm exec vitest run --maxWorkers=1`）
- `pnpm lint`、`pnpm build`
- 涉及 APK 时：`pnpm exec cap copy android` + `gradlew.bat lintDebug assembleDebug`（本改动为纯前端，是否打包由用户决定）
