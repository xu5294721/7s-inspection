# 无照片评价项点与检查内容模板设计

## 目标

修复“只选择检查评价内容、未拍照时，项点在复核和 Word 中消失”的问题，并增加可配置的检查内容模板：全局默认模板可定义大项、小项和默认小项；具体检查项点可以覆盖全局模板；历史巡检保留当时的文字快照。

## 当前问题结论

当前编辑器在检查内容保存后尝试自动创建一个“好的”评价组，但父页面仍处于该项点的保存状态，紧接着的评价组创建会被 `savingEntryIds` 竞态拦截。即使空照片组已经存在，复核页仍在 `ReviewPage.tsx` 中按 `photoIds.length > 0` 过滤，因此无照片评价组不参与复核列表、分类排序和焦点定位。现有 `reportModel` 已支持空照片组，故 Word 漏项的首要原因是评价组没有可靠落库或被复核链路过滤，而不是图片生成器不能输出纯文字项点。

## 设计原则与约束

- 单用户、离线优先、IndexedDB 本地存储，不增加账号、后端或云同步。
- 旧备份 ZIP 必须可读取；新备份增加的模板数据必须有明确 schema 版本兼容策略。
- 旧巡检记录和旧三分类模板继续可读，旧检查选择值不因当前模板改名而改变。
- 原图不修改；Word 仍使用现有图片处理和压缩链路。
- 每次业务改动先写失败测试，再写最小实现；完成后运行受影响测试、全量测试、lint 和 build。

## 方案一：无照片评价项点的保存与复核

### 数据流

将“保存检查内容”和“确保评价组存在”合并到 `InspectionRepository` 的一个 IndexedDB 事务中。事务接收 `inspectionId`、`entryId` 和规范化后的 selections：

1. 更新 `entries.checkSelections`。
2. 当 selections 非空且 entry 没有 group 时，创建一个 `category: "good"`、`photoIds: []` 的评价组，并把组 ID 加入 entry.groupIds。
3. 当 selections 为空时，只删除系统自动创建、无照片、未人工编辑且无考核信息的空组；人工明确创建或编辑过的组不删除。
4. 更新巡检记录状态和时间戳，并重新计算完成状态。

这样页面不再依赖“保存回调之后立即创建组”的异步时序，也不需要让子组件感知父组件的保存锁。

### 复核页行为

- `visibleGroups` 改为包含所有有效评价组，不再以 `photoIds.length > 0` 作为可见条件。
- 分类排序的输入包含有照片组和无照片组；无照片组可以拖动排序，但照片拖动区域为空。
- 摘要统计将“评价组数量”和“照片数量”分开显示，无照片组计入组数、照片数保持为 0。
- 错误定位允许定位到无照片组的文字卡片。

### Word 行为

保留现有 `reportModel` 对空照片组的支持，并补充真实流程回归测试，验证：选择检查内容后保存的 entry 和 group、复核排序后的顺序，以及生成的 `document.xml` 均包含纯文字项点。

## 方案二：检查内容模板模型

### 模板数据结构

新增独立的 `inspectionCheckTemplates` 数据表。模板包含：

```ts
interface InspectionCheckTemplate {
  id: string;
  name: string;
  scope: "global" | "item";
  checklistItemId: string | null;
  categories: InspectionCheckTemplateCategory[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface InspectionCheckTemplateCategory {
  id: string;
  label: string;
  enabled: boolean;
  defaultOptionId: string | null;
  options: InspectionCheckTemplateOption[];
  order: number;
}

interface InspectionCheckTemplateOption {
  id: string;
  label: string;
  enabled: boolean;
  order: number;
}
```

具体检查项点与覆盖模板的关系使用独立的 `inspectionCheckTemplateAssignments` 数据表保存，不直接改变 `ChecklistItem` 和 Excel 项点库字段；没有 assignment 时使用当前全局默认模板。模板仓库对页面提供统一的 effective template 查询。

`InspectionCheckSelection.category` 从固定联合类型扩展为稳定模板分类 ID 字符串；旧的 `environment`、`placement`、`equipment` 和 `safety` 值原样保留并由内置模板识别。`categoryLabel` 作为新增的历史显示快照字段，不能用当前模板标签覆盖。

### 选择快照

现有 `InspectionCheckSelection` 保留 `category` 和 `value` 字段以兼容旧备份，并增加可选的 `categoryLabel` 字段。新记录写入当时的大项名称和小项文字；旧记录缺少该字段时，使用内置旧定义映射。报告文本优先使用快照，不能重新从当前模板反查历史文字。

### 兼容与迁移

- 内置默认模板包含现有环境卫生、物品定置、设备清洁保养定义，并兼容旧 `safety` 选择的读取和清洗逻辑。
- 应用启动时确保至少存在一个全局默认模板；已有用户数据不强制重写为新模板。
- 备份 schema 增加模板表数据；恢复旧 schema 时自动补齐内置默认模板，恢复新 schema 时校验模板 ID、分类、选项和默认项引用。
- 删除或停用模板只影响后续选择，不删除历史巡检快照。

## 方案三：页面交互

### 设置页

新增“检查内容模板”入口。模板编辑器支持：

- 新增、修改、排序、停用大项；
- 新增、修改、排序、停用小项；
- 为每个大项选择一个默认小项或取消默认；
- 新建项点覆盖模板，并选择具体项点；
- 保存前校验名称非空、启用大项至少一个启用小项、默认小项必须属于本大项。

### 检查页和复核页

- 选择器根据 effective template 渲染大项和启用小项。
- 新项点没有历史选择时，在界面预选各大项的默认小项；只有点击确认才写入巡检快照。
- 用户手动选择后覆盖默认值；同一大项最多保留一个选择。
- “自定义内容”仍可输入，写入 `isCustom: true`，不修改模板。
- 复核编辑使用同一套 effective template，但已保存快照继续显示原文字。

## 错误处理

- 模板读取失败或数据损坏时回退到内置默认模板，并在设置页显示需要修复的提示。
- 默认项失效、模板 ID 不存在或选项停用时，不覆盖已有巡检快照；新选择器跳过失效默认项并允许用户重新选择。
- 保存选择和创建/删除空组必须同事务完成；任一步失败时不更新页面成功状态。
- 生成 Word 前继续执行现有报告完整性校验，纯文字项点缺少评价内容时给出可定位错误。

## 测试范围

### 无照片项点

- repository 事务：非空 selections 自动创建空 good group；清空 selections 删除未编辑空组；人工编辑组不删除。
- 页面流程：选择“环境卫生—干净整洁”后，entry/group 同时落库，完成标记为真。
- 复核：无照片组可见、计入组数、可参与排序和错误定位。
- Word：纯文字项点进入正确分类章节，顺序和文本正确。
- 旧数据：已有空照片组、旧缺失 selections、旧三分类数据继续可读。

### 模板

- 模板 schema、默认项引用和停用规则校验。
- 全局模板和项点覆盖模板的 effective template 解析。
- 默认小项预选、用户覆盖、同大项单选和自定义小项。
- 旧 selection 兼容、新 selection 快照保留和模板改名不影响历史报告。
- 备份导出/恢复包含模板表，旧备份恢复自动补内置模板。

## 发布边界

第一阶段只交付上述数据可靠性和模板能力，不增加账号、云同步、统计排名、整改闭环或多用户协作。完成后升级 Android 版本，重新运行全量测试、lint、Web build、Capacitor copy 和 Android assembleDebug，再生成新的 APK 和 Release。
