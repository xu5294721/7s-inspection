# Word 首页照片补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不拆分检查项点、不压缩照片且不妨碍后续项点连续排版的前提下，补齐 Word 首页首个一图或两图项点的底部留白。

**Architecture:** 保持 `PhotoTableLayout` 作为唯一的渲染和分页尺寸来源。仅在生成首页首个有照片项点时，先用常规布局判断下一个完整项点是否还能放入首页；不能放入时，基于当前页余量生成一个仅增高的自适应布局覆盖。三图、四图、固定模式和非首页项点继续使用既有布局。

**Tech Stack:** TypeScript、`docx` 9.7.1、JSZip、Vitest、LibreOffice headless。

## Global Constraints

- 仅自适应导出模式生效，固定模式不变。
- 仅报告首页首个有照片的项点生效，且仅对 1 张或 2 张照片生效。
- 常规单图为 135×90mm，首页单图最大 150×120mm；常规双图为 78×58mm，首页双图每张最大 78×110mm。
- 仅增加首页首项照片高度，不裁剪、不缩小宽度、不修改原始照片或现有业务设置。
- 若下一个完整项点按常规尺寸可放入首页，首项不得放大。
- 三图维持 2+1，四图维持 2×2，项点文字与自身照片继续不可拆分。

---

### Task 1: 为首页补齐写入失败回归

**Files:**
- Modify: `C:\Users\xj\Desktop\7s管理\.worktrees\codex-word-photo-layout\app\src\features\reports\generateDocx.test.ts`

**Interfaces:**
- Consumes: `makeInspection`、`makeTemplate`、`makePhotoGroup`、`makePhoto`、`buildReportModel`、`drawingExtents`、`paragraphContaining`。
- Produces: 首页一图/两图扩展、可连续排下一个项点时不扩展、三图不变的 XML 回归覆盖。

- [ ] **Step 1: 添加首页单图扩展失败测试。**

构造含较长标题前置文本、一个一图好项点、一个无法同页容纳的四图后续项点的自适应报告。提取 `drawingExtents(documentXml)` 并断言首图的 EMU 尺寸大于常规 135×90mm、宽度不超过 150mm、高度不超过 120mm；后续四图保持 78×58mm。

- [ ] **Step 2: 添加首页双图扩展失败测试。**

构造相同前置文本、一个两图项点和一个无法同页容纳的四图后续项点。断言前两张 `wp:extent` 相等、其高度大于常规 58mm且不超过 110mm，并断言后续四图仍为常规相等尺寸。

- [ ] **Step 3: 添加连续排版保护测试。**

构造首页首个一图项点后仍能容纳一个一图项点的报告。断言第一个图片尺寸仍精确等于 135×90mm，且第二项点段落不含 `<w:pageBreakBefore/>`。

- [ ] **Step 4: 运行测试确认 RED。**

运行：

```powershell
pnpm exec vitest run src/features/reports/generateDocx.test.ts
```

预期：新增首页扩展断言失败；现有报告生成测试仍可运行。

---

### Task 2: 实现首页首项条件性画幅覆盖

**Files:**
- Modify: `C:\Users\xj\Desktop\7s管理\.worktrees\codex-word-photo-layout\app\src\features\reports\generateDocx.ts`
- Test: `C:\Users\xj\Desktop\7s管理\.worktrees\codex-word-photo-layout\app\src\features\reports\generateDocx.test.ts`

**Interfaces:**
- Consumes: `PhotoTableLayout`、`PageLayoutEstimator.remainingPageTwips()`、`photoGroupBlockHeightTwips()`、当前按报告顺序排列的 `ReportGroup`。
- Produces: `firstPageAdaptiveLayout()`，在满足条件时返回放大后的 `PhotoTableLayout`，否则返回常规布局。

- [ ] **Step 1: 增加首页画幅常量和可选画幅参数。**

在现有自适应常量旁新增：

```ts
const firstPageSingleFrameWidthMm = 150;
const firstPageSingleFrameMaxHeightMm = 120;
const firstPageTwoFrameMaxHeightMm = 110;
```

将 `photoTableLayout` 改为接受可选覆盖：

```ts
function photoTableLayout(
  model: ReportModel,
  photos: PreparedPhoto[],
  adaptiveFrameOverride?: PhotoPlacement,
): PhotoTableLayout
```

仅在 `model.photoLayoutMode === "adaptive"` 且覆盖存在时把该覆盖复制到每张照片；固定模式忽略覆盖。

- [ ] **Step 2: 实现首页布局选择函数。**

新增：

```ts
function firstPageAdaptiveLayout(
  model: ReportModel,
  groupText: string,
  photos: PreparedPhoto[],
  remainingPageTwips: number,
  nextGroupHeightTwips: number | null,
): PhotoTableLayout
```

函数先创建常规布局；在以下任一条件下直接返回常规布局：非自适应、照片数量不是 1 或 2、常规完整项点已不能放入剩余首页空间、或 `nextGroupHeightTwips !== null` 且“常规首项高度 + 下一项高度”仍能放入。

否则从 `remainingPageTwips - paragraphHeightTwips(model, groupText) - photoBlockSpacingTwips - photoBlockSafetyTwips` 计算照片表可用高度。单图使用 `min(120mm, 可用高度)`，宽度为 `min(150mm, 内容宽度)`；双图保持 78mm 宽，使用 `min(110mm, 可用高度)`。当计算结果不大于常规高度时返回常规布局。

- [ ] **Step 3: 在报告生成循环中仅对首页首个有照片项点使用覆盖。**

在章节循环前创建按输出顺序的组列表并找到第一个 `group.photos.length > 0` 的组。生成该组时计算紧接下一组的常规完整高度；把 `pagination.remainingPageTwips()` 和此高度传给 `firstPageAdaptiveLayout()`。只有该组尚未触发分页且确实是整个报告第一个有照片项点时使用返回布局。其余调用继续使用 `photoTableLayout(model, preparedPhotos)`。

- [ ] **Step 4: 运行聚焦测试确认 GREEN。**

运行：

```powershell
pnpm exec vitest run src/features/reports/generateDocx.test.ts
```

预期：所有报告生成测试通过，新增三项首页补齐断言通过。

- [ ] **Step 5: 提交实现。**

```powershell
git add -- app/src/features/reports/generateDocx.ts app/src/features/reports/generateDocx.test.ts
git commit -m "fix: fill sparse Word first-page photo layout"
```

---

### Task 3: 真实渲染与全量验证

**Files:**
- Read: `C:\Users\xj\Desktop\7s管理\.worktrees\codex-word-photo-layout\app\src\features\reports\generateDocx.ts`
- Create temporarily: `C:\Users\xj\Desktop\7s管理\.worktrees\codex-word-photo-layout\tmp\docs\word-first-page-fill.docx`
- Create temporarily: `C:\Users\xj\Desktop\7s管理\.worktrees\codex-word-photo-layout\tmp\docs\word-first-page-fill.pdf`

**Interfaces:**
- Consumes: 已完成的 `generateDocx`、真实 JPEG 测试素材和 LibreOffice。
- Produces: 首页单图、首页双图、首页可继续排下一项的视觉证据。

- [ ] **Step 1: 生成三份代表性 DOCX。**

用 `tests/fixtures/site-photo.jpg` 生成：

```text
首页单图 + 无法同页容纳的四图后续项点
首页双图 + 无法同页容纳的四图后续项点
首页一图 + 可同页容纳的一图后续项点
```

三份报告均使用真实标题、导语和章节文本，以复现首页前置文字占高的场景。

- [ ] **Step 2: 用 LibreOffice 转 PDF 并检查页面 PNG。**

运行：

```powershell
& 'C:\Program Files\LibreOffice\program\soffice.com' --headless --convert-to pdf --outdir <render-dir> <docx>
```

再用 Poppler `pdftoppm.exe -png -r 120` 输出页面 PNG。检查首页照片更饱满、无裁剪、首项文字未与照片分离，且连续排版场景仍显示两个项点。

- [ ] **Step 3: 运行全量验证。**

```powershell
pnpm exec vitest run --maxWorkers=1 --reporter=dot
pnpm run lint
pnpm run build
```

预期：测试零失败、lint 退出码 0、生产构建退出码 0。

- [ ] **Step 4: 更新设计说明的执行记录并提交。**

在 `docs/superpowers/specs/2026-08-09-word-first-page-photo-fill-design.md` 追加已验证的最终尺寸和命令结果，然后提交：

```powershell
git add -- docs/superpowers/specs/2026-08-09-word-first-page-photo-fill-design.md
git commit -m "docs: record Word first-page layout verification"
```

## Plan Self-Review

- Spec coverage: Task 1 覆盖首页一图、两图、连续排版与三图/四图不变的回归；Task 2 限定生效范围并从同一布局模型计算画幅；Task 3 覆盖真实渲染和全量构建。
- Placeholder scan: 计划没有未定义步骤或待补充内容；所有命令、文件和尺寸均已列明。
- Type consistency: `firstPageAdaptiveLayout()` 返回 `PhotoTableLayout`，其输出由 `photoGroupBlockHeightTwips()` 和 `photoGroupBlock()` 直接消费，不引入新的渲染路径。
