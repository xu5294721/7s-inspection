# 巡检项点单项展开与完成状态 Implementation Plan

**Goal:** 将巡检项点改为单项展开，并通过照片和已保存检查内容标识完成状态。

**Architecture:** `InspectionPage` 持有当前展开项点 ID，并根据当前草稿图数据计算完成状态；`InspectionEntryEditor` 继续负责展开状态下的拍照、检查内容和照片编辑。样式只新增标题列表、展开面板和完成状态表现。

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright, Vite.

## Global Constraints

- 一次只展开一个项点。
- 完成条件为至少一张照片且至少一条已保存检查内容。
- 不修改巡检数据库结构和历史记录。

### Task 1: Add failing interaction tests

**Files:**
- Modify: `app/src/features/inspections/inspection-flow.test.tsx`
- Modify: `app/tests/e2e/inspection-flow.spec.ts`

- [ ] 验证默认不显示项点内部编辑控件。
- [ ] 验证点击标题展开该项、点击其他标题收起前一项。
- [ ] 验证照片和检查内容共同决定完成样式。

### Task 2: Implement accordion rendering

**Files:**
- Modify: `app/src/features/inspections/InspectionPage.tsx`
- Modify: `app/src/styles/global.css`

- [ ] 增加当前展开项点状态及项点完成判断。
- [ ] 将每个项点改为可访问的标题按钮，条件渲染现有编辑器。
- [ ] 添加完成背景色与展开状态样式。

### Task 3: Verify

**Files:**
- Test: `app/src/features/inspections/inspection-flow.test.tsx`
- Test: `app/tests/e2e/inspection-flow.spec.ts`

- [ ] 运行目标测试、全部单元测试、移动端端到端测试、生产构建和 lint。
