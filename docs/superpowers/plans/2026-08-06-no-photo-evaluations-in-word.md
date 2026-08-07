# 无照片评价组纳入 Word 生成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让只选了评价内容（未拍照）的项点以文字条目形式出现在生成的 Word 报告中，与有照片项点连续编号，且同样参与模板章节校验。

**Architecture:** 在 `buildReportModel` 中不再按照片过滤评价组（`photographedGroups` → `reportGroups` 纳入全部组，无照片组 `photos: []`）；`generateDocx` 仅在组内有照片时输出照片表格；`reportValidation` 的模板章节校验去掉照片数量条件。编号、排序、奖考附加、章节标题逻辑全部复用现有实现。

**Tech Stack:** TypeScript、Vitest 4、docx 9、oxlint、vite。

## Global Constraints

- 保留"报告至少需要一张已归组照片"校验（`REPORT_PHOTO_REQUIRED`），纯文字巡检不允许生成 Word。
- 无照片条目与有照片条目在同一章节内连续编号；无照片条目下方不生成照片区域、不生成空表格。
- 无照片条目若填奖励/考核信息，文字后同样附加"（奖励：XX，XX元）"/"（考核：XX，XX元）"。
- 章节只要有条目（无论有无照片）就生成标题。
- 无照片组同样参与 `PHOTO_CATEGORY_NOT_IN_TEMPLATE` 校验；校验文案改为"评价分类不在当前模板章节中，请切换至最新四分类模板。"。
- 不改 `ReportGroup` 接口、不改数据库结构、不改备份格式、不改模板结构。
- 提交信息遵循仓库风格（`feat:`/`fix:`/`test:`/`docs:` 前缀）。

---

### Task 1: reportModel 纳入无照片组

**Files:**
- Modify: `app/src/features/reports/reportModel.ts`（第 116、118 行）
- Modify: `app/src/features/reports/reportModel.test.ts`（第 369-404 行现有测试 + 新增测试）

**Interfaces:**
- Consumes: `buildReportModel(graph, template)` 现有签名不变。
- Produces: `ReportGroup.photos` 对无照片组为 `[]`；`ReportSectionModel.groups` 包含无照片组；编号在章节内连续。

- [ ] **Step 1: 更新现有测试（先改断言为期望行为）**

在 `app/src/features/reports/reportModel.test.ts` 中，将 `"excludes entries without photos from report body sections"` 测试改为 `"includes entries without photos in report body sections with empty photo list"`：

```ts
test("includes entries without photos in report body sections with empty photo list", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const photographedEntry = {
    ...inspection.entries[0],
    id: "entry-photographed",
    groupIds: ["group-photographed"],
  };
  const noPhotoEntry = {
    ...inspection.entries[0],
    id: "entry-no-photo",
    groupIds: ["group-no-photo"],
  };
  const model = buildReportModel({
    inspection: { ...inspection, entries: [photographedEntry, noPhotoEntry] },
    groups: [
      makePhotoGroup({
        id: "group-photographed",
        entryId: photographedEntry.id,
        description: "有照片项。",
        photoIds: ["photo-photographed"],
      }),
      makePhotoGroup({
        id: "group-no-photo",
        entryId: noPhotoEntry.id,
        description: "无照片项。",
        photoIds: [],
      }),
    ],
    photos: [makePhoto(undefined, { id: "photo-photographed", groupId: "group-photographed" })],
    template,
  }, template);

  expect(model.sections.flatMap((section) => section.groups.map((group) => group.text)))
    .toEqual(["有照片项。", "无照片项。"]);
  const noPhotoGroup = model.sections.flatMap((section) => section.groups)
    .find((group) => group.id === "group-no-photo")!;
  expect(noPhotoGroup.photos).toEqual([]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && ./node_modules/.bin/vitest run src/features/reports/reportModel.test.ts --maxWorkers=1 -t "includes entries without photos"`
Expected: FAIL（当前 text 列表只有 `["有照片项。"]`）。

- [ ] **Step 3: 实现（reportModel.ts 纳入全部组）**

修改 `app/src/features/reports/reportModel.ts` 第 116、118 行：

```ts
  const reportGroups = graph.groups;
  const sections = orderedTemplateSections.map(({ category, title }): ReportSectionModel => {
    const categoryGroups = reportGroups.filter((group) => group.category === category);
```

（`photographedGroups` 变量重命名为 `reportGroups`，仅这两处引用；其余代码不动。无照片组 `group.photoIds.map(...)` 自然得到空数组。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && ./node_modules/.bin/vitest run src/features/reports/reportModel.test.ts --maxWorkers=1`
Expected: 全部 PASS。

- [ ] **Step 5: 新增测试（连续编号 + 纯文字章节标题 + 奖考附加）**

在 `app/src/features/reports/reportModel.test.ts` 添加：

```ts
test("numbers photo and no-photo groups consecutively within a section", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const firstEntry = { ...inspection.entries[0], id: "entry-1", groupIds: ["group-1"] };
  const secondEntry = { ...inspection.entries[0], id: "entry-2", groupIds: ["group-2"] };
  const model = buildReportModel({
    inspection: { ...inspection, entries: [firstEntry, secondEntry] },
    groups: [
      makePhotoGroup({ id: "group-1", entryId: firstEntry.id, photoIds: ["photo-1"] }),
      makePhotoGroup({ id: "group-2", entryId: secondEntry.id, description: "纯文字项。", photoIds: [] }),
    ],
    photos: [makePhoto(undefined, { id: "photo-1", groupId: "group-1" })],
    template,
  }, template);

  const goodGroups = model.sections.find((section) => section.category === "good")!.groups;
  expect(goodGroups.map((group) => group.number)).toEqual([1, 2]);
  expect(goodGroups.map((group) => group.photos.length)).toEqual([1, 0]);
});

test("keeps section title for a section that only has no-photo entries", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const entry = { ...inspection.entries[0], id: "entry-only-text", groupIds: ["group-only-text"] };
  const model = buildReportModel({
    inspection: { ...inspection, entries: [entry] },
    groups: [
      makePhotoGroup({ id: "group-only-text", entryId: entry.id, description: "仅文字。", photoIds: [] }),
    ],
    photos: [makePhoto()],
    template,
  }, template);

  const sections = model.sections;
  expect(sections.length).toBeGreaterThan(0);
  expect(sections[0].title).toBe("好的方面");
  expect(sections[0].groups).toHaveLength(1);
});

test("appends reward info to a no-photo good entry", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const entry = { ...inspection.entries[0], id: "entry-reward", groupIds: ["group-reward"] };
  const model = buildReportModel({
    inspection: { ...inspection, entries: [entry] },
    groups: [
      makePhotoGroup({
        id: "group-reward",
        entryId: entry.id,
        description: "表现良好。",
        photoIds: [],
        awardAssessment: { type: "reward", people: "张三", amount: 50 },
      }),
    ],
    photos: [makePhoto()],
    template,
  }, template);

  const group = model.sections[0].groups[0];
  expect(group.text).toContain("（奖励：张三，50元）");
});
```

（`makePhotoGroup` 需支持 `awardAssessment` 透传——检查 fixtures 中 `makePhotoGroup` 是否已含该字段，若不含则在 fixtures 中补默认 `awardAssessment: null` 透传；若已支持则直接用。）

- [ ] **Step 6: 运行测试确认通过**

Run: `cd app && ./node_modules/.bin/vitest run src/features/reports/reportModel.test.ts --maxWorkers=1`
Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add app/src/features/reports/reportModel.ts app/src/features/reports/reportModel.test.ts
git commit -m "feat: include no-photo evaluation groups in Word report model"
```

---

### Task 2: generateDocx 无照片组只输出文字

**Files:**
- Modify: `app/src/features/reports/generateDocx.ts`（输出循环约第 311-320 行）
- Test: `app/src/features/reports/generateDocx.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ReportModel`（无照片组 `photos: []`）。
- Produces: 无照片组只输出 `"N. 文字"` 段落，无 `<w:tbl>`、无 `<w:drawing>`。

- [ ] **Step 1: 写失败测试**

在 `app/src/features/reports/generateDocx.test.ts` 添加：

```ts
test("emits only the text line for a no-photo group without a photo table", async () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const entry = { ...inspection.entries[0], id: "entry-no-photo", groupIds: ["group-no-photo"] };
  const model = buildReportModel({
    inspection: { ...inspection, entries: [entry] },
    groups: [
      makePhotoGroup({ id: "group-no-photo", entryId: entry.id, description: "纯文字评价。", photoIds: [] }),
    ],
    photos: [makePhoto()],
    template,
  }, template);

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const body = documentXml.slice(documentXml.indexOf("<w:body>"), documentXml.indexOf("</w:body>"));

  expect(body).toContain("纯文字评价。");
  expect(body).not.toContain("<w:tbl>");
  expect(body).not.toContain("<w:drawing>");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && ./node_modules/.bin/vitest run src/features/reports/generateDocx.test.ts --maxWorkers=1 -t "only the text line"`
Expected: FAIL（当前无照片组被 reportModel 过滤后 sections 为空，或生成后 body 含表格——取决于 Task 1 是否已合入；若 Task 1 已合入则失败点为仍输出空表格）。

- [ ] **Step 3: 实现（条件输出照片表格）**

修改 `app/src/features/reports/generateDocx.ts` 输出循环（约 311-320 行）：

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

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && ./node_modules/.bin/vitest run src/features/reports/generateDocx.test.ts --maxWorkers=1`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/features/reports/generateDocx.ts app/src/features/reports/generateDocx.test.ts
git commit -m "feat: skip photo table for no-photo groups in Word output"
```

---

### Task 3: reportValidation 无照片组同样校验模板章节

**Files:**
- Modify: `app/src/domain/reportValidation.ts`（约第 132-143 行）
- Test: `app/src/domain/reportValidation.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `PHOTO_CATEGORY_NOT_IN_TEMPLATE` 对无照片组同样触发；校验文案改为"评价分类不在当前模板章节中，请切换至最新四分类模板。"。

- [ ] **Step 1: 写失败测试**

在 `app/src/domain/reportValidation.test.ts` 添加：

```ts
test("requires the latest four-category template for no-photo general groups too", () => {
  const errors = validateReportReadiness(makeGraph({
    groups: [{ ...group, category: "general", description: "general performance", photoIds: [] }],
    photos: [photo],
  }));

  expect(errors).toContainEqual(expect.objectContaining({
    code: "PHOTO_CATEGORY_NOT_IN_TEMPLATE",
    field: "template.sections",
    message: "评价分类不在当前模板章节中，请切换至最新四分类模板。",
  }));
});
```

（检查 `makeGraph`/`group`/`photo` 在测试文件中的既有定义；`photos` 需至少保留一张已归组照片以满足 `REPORT_PHOTO_REQUIRED` 之外的组校验——`photo` 必须仍被某组引用，否则会产生 `PHOTO_NOT_GROUPED` 干扰断言；若既有 `group` 变量被复用，注意用 `{ ...group, ... }` 派生且让 `photo.groupId` 指向该组。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && ./node_modules/.bin/vitest run src/domain/reportValidation.test.ts --maxWorkers=1 -t "no-photo general groups"`
Expected: FAIL（当前无照片组不触发该校验）。

- [ ] **Step 3: 实现（去掉照片数量条件 + 改文案）**

修改 `app/src/domain/reportValidation.ts`（约第 132-143 行）：

```ts
    if (
      templateCategories &&
      !templateCategories.has(group.category)
    ) {
      errors.push(error(
        group.id,
        "template.sections",
        "PHOTO_CATEGORY_NOT_IN_TEMPLATE",
        "评价分类不在当前模板章节中，请切换至最新四分类模板。",
      ));
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && ./node_modules/.bin/vitest run src/domain/reportValidation.test.ts --maxWorkers=1`
Expected: 全部 PASS（现有 `"requires the latest four-category template for photographed general groups"` 测试仍通过——其断言用 `toContainEqual` + `objectContaining`，不依赖 message 精确匹配；若现有测试断言了旧 message 字符串，同步更新为"评价分类不在当前模板章节中，请切换至最新四分类模板。"）。

- [ ] **Step 5: 提交**

```bash
git add app/src/domain/reportValidation.ts app/src/domain/reportValidation.test.ts
git commit -m "fix: validate template sections for no-photo evaluation groups"
```

---

### Task 4: 回归验证与提交

**Files:**
- 无新文件；验证 Task 1-3 全部改动。

**Interfaces:**
- Consumes: Task 1-3 全部改动。

- [ ] **Step 1: 全量测试**

Run: `cd app && ./node_modules/.bin/vitest run --maxWorkers=1`
Expected: 49 个测试文件全部通过（当前 580 个测试 + 新增约 6 个）。

- [ ] **Step 2: lint 与构建**

Run: `cd app && ./node_modules/.bin/oxlint && ./node_modules/.bin/tsc -b && ./node_modules/.bin/vite build`
Expected: 0 error，build 成功。

- [ ] **Step 3: 确认无其他依赖"无照片组被排除"的测试**

Run: `cd app && grep -rn "excludes entries without photos\|no-photo\|noPhoto\|photoIds: \[\]" src --include="*.test.ts" --include="*.test.tsx" | grep -v "reportModel.test.ts\|reportValidation.test.ts\|generateDocx.test.ts"`
Expected: 无残留引用（如有，评估并更新）。

- [ ] **Step 4: 提交（如 Task 1-3 已各自提交则跳过；检查工作区）**

```bash
cd C:/Users/xj/Desktop/7s管理 && git status --short
```

Expected: 工作区干净（或仅未跟踪的本地工具目录）。

- [ ] **Step 5: 视用户需要构建 APK**

若用户要求试用：升版本号（建议 1.0.10 / versionCode 11，须与用户确认），`cap copy android` + `gradlew.bat lintDebug assembleDebug`，APK 复制到 `output/`。

---

## Self-Review 记录

- **Spec coverage:** 需求 1（文字条目、连续编号、无照片区域）→ Task 1 + Task 2；需求 2（保留最少照片校验）→ 未触碰 `graph.photos.length === 0` 校验（Task 1 不改该行）；需求 3（奖考附加）→ Task 1 测试覆盖（复用现有 `evaluationSuffix`）；需求 4（纯文字章节标题）→ Task 1 测试覆盖（`sections[0].title` 断言）；需求 5（无照片组同样校验）→ Task 3。全部覆盖。
- **Placeholder scan:** 无 TBD/TODO；所有代码步骤给出完整实现。
- **Type consistency:** `reportGroups` 变量名在 Task 1 定义与使用一致；`group.photos.length > 0` 在 Task 2 与 Task 1 的 `photos: []` 语义一致；`PHOTO_CATEGORY_NOT_IN_TEMPLATE` code/field 在 Task 3 测试与实现一致；`makePhotoGroup` 的 `awardAssessment` 透传在 Task 1 测试与 fixtures 一致（Step 5 注明检查）。
- **风险注记:** Task 3 测试中 `photo` 必须仍被某组引用以避免 `PHOTO_NOT_GROUPED` 干扰；现有 `reportValidation.test.ts` 若断言旧 message 需同步更新；`makePhotoGroup` fixtures 若不含 `awardAssessment` 字段需补透传（Task 1 Step 5 已注明检查）。
