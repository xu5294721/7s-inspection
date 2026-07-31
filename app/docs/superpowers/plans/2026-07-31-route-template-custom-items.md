# 路线模板新增项点与排序 Implementation Plan

**Goal:** 在路线模板管理中新增自定义检查项点，并支持按模板顺序上移、下移后保存。

**Architecture:** 模板编辑器维护已选项点顺序和待保存自定义项点；管理页面通过仓储层一次事务保存新增项目和模板。统一的自定义项点工厂保证“新建巡检”和“路线模板”生成相同的数据结构。

**Tech Stack:** React 19, TypeScript, Dexie, Vitest, Testing Library, Vite.

## Global Constraints

- 自定义项点只输入名称。
- 新增项点保存后进入项目库，并加入当前模板。
- 排序使用上移/下移按钮，不改变历史巡检记录。
- 不引入新的第三方依赖。

### Task 1: Add failing coverage

**Files:**
- Modify: `app/src/features/routeTemplates/route-template-management.test.tsx`
- Modify: `app/src/db/repositories.test.ts`

- [ ] 添加新建模板新增自定义项点、调整顺序并检查模板和项目库的测试。
- [ ] 添加仓储事务保存和重复名称校验测试。
- [ ] 运行目标测试，确认测试因当前 UI/接口不存在而失败。

### Task 2: Implement shared custom item persistence

**Files:**
- Create: `app/src/domain/customChecklistItem.ts`
- Modify: `app/src/db/routeTemplateRepository.ts`
- Modify: `app/src/app/dependencies.ts`
- Modify: `app/src/features/inspections/NewInspectionPage.tsx`
- Modify: `app/src/features/routeTemplates/RouteTemplateManagementPage.tsx`

- [ ] 提供统一的自定义项点默认内容工厂。
- [ ] 增加模板与自定义项点的事务保存接口。
- [ ] 将新建巡检的自定义项点创建逻辑改为复用工厂。

### Task 3: Implement editor add-and-sort interaction

**Files:**
- Modify: `app/src/features/routeTemplates/RouteTemplateEditor.tsx`
- Modify: `app/src/features/routeTemplates/RouteTemplateManagementPage.tsx`

- [ ] 增加新增检查项对话框。
- [ ] 增加已选路线顺序列表和上移/下移按钮。
- [ ] 让勾选、取消勾选、全选和全不选保持顺序一致。
- [ ] 将待保存自定义项点传递到保存回调。

### Task 4: Verify

**Files:**
- Test: `app/src/features/routeTemplates/route-template-management.test.tsx`
- Test: `app/src/db/repositories.test.ts`

- [ ] 运行相关 Vitest 测试。
- [ ] 运行 `pnpm build` 和 `pnpm lint`。
- [ ] 复核生产构建结果。
