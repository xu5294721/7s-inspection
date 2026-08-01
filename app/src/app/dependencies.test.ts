import { createTestDb } from "../db/database";
import { createBackup } from "../db/backupRepository";
import { InspectionRepository } from "../db/inspectionRepository";
import { ItemRepository } from "../db/itemRepository";
import { RouteTemplateRepository } from "../db/routeTemplateRepository";
import { TemplateRepository } from "../db/templateRepository";
import { createInspection } from "../domain/inspection";
import { makeChecklistItem, makeTemplate } from "../test/fixtures";
import { createAppDependencies, initializeApp } from "./dependencies";
import { ensureRouteCatalog } from "./routeCatalogMigration";
import defaultChecklistItemsJson from "../data/default-checklist-items.json";
import type { InspectionRouteTemplate } from "../domain/models";

const legacyItems = defaultChecklistItemsJson as ReturnType<typeof makeChecklistItem>[];

function malformedRouteTemplate(
  overrides: Partial<InspectionRouteTemplate> = {},
): InspectionRouteTemplate {
  return {
    id: "route-template-default",
    name: "默认模板",
    itemIds: [],
    isDefault: false,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

test("initializes the stable 39-route catalog in order and creates its default template", async () => {
  const database = createTestDb(`route-catalog-empty-${Date.now()}`);
  const dependencies = createAppDependencies(database);

  await initializeApp(dependencies);

  const items = await dependencies.itemRepository.listEnabled();
  expect(items).toHaveLength(39);
  expect(items.map((item) => item.id)).toEqual(
    Array.from({ length: 39 }, (_, index) => `core-route-${String(index + 1).padStart(2, "0")}`),
  );
  expect(items[30]).toMatchObject({
    routeName: "焊后间与门吊之间区域",
    area: "焊后间与门吊之间区域",
    part: "焊后间与门吊之间区域",
    standard: "检查焊后间与门吊之间区域7S管理落实情况",
    team: "相关责任工班",
  });
  expect((await dependencies.routeTemplateRepository.list())[0]).toMatchObject({
    id: "route-template-default",
    itemIds: items.map((item) => item.id),
    isDefault: true,
  });
});

test("migrates legacy built-ins once while preserving user items and historical snapshots", async () => {
  const database = createTestDb(`route-catalog-migration-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const items = new ItemRepository(database);
  const legacyItem = legacyItems[0];
  const { enabled: _enabled, createdAt: _createdAt, updatedAt: _updatedAt, ...legacySnapshot } = legacyItem;

  await database.checklistItems.bulkAdd(legacyItems);
  await database.checklistItems.put(makeChecklistItem({ id: "user-item", routeName: "用户路线" }));
  await new InspectionRepository(database).saveGraph({
    inspection: createInspection([legacyItem], "legacy-inspection", "2026-07-29"),
    groups: [],
    photos: [],
  });

  await initializeApp(dependencies);
  await initializeApp(dependencies);

  expect((await items.get(legacyItem.id))?.enabled).toBe(false);
  expect((await items.get("user-item"))?.enabled).toBe(true);
  expect(await items.get("core-route-01")).toMatchObject({ enabled: true, routeOrder: 1 });
  expect(await database.settings.get("inspectionRouteCatalogVersion")).toMatchObject({ value: 2 });
  expect((await new InspectionRepository(database).getGraph("legacy-inspection"))?.inspection.entries[0])
    .toMatchObject({ itemId: legacyItem.id, itemSnapshot: legacySnapshot });
});

test("repairs missing stable records after the catalog version is recorded without disabling new rows", async () => {
  const database = createTestDb(`route-catalog-repair-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const routeTemplates = new RouteTemplateRepository(database);
  const legacyItem = legacyItems[0];

  await initializeApp(dependencies);
  await database.checklistItems.delete("core-route-07");
  await database.routeTemplates.delete("route-template-default");
  await database.checklistItems.add({ ...legacyItem, id: "legacy-after-version" });

  await initializeApp(dependencies);

  expect(await database.checklistItems.get("core-route-07")).toMatchObject({ enabled: true });
  expect(await routeTemplates.get("route-template-default")).toMatchObject({
    itemIds: Array.from({ length: 39 }, (_, index) => `core-route-${String(index + 1).padStart(2, "0")}`),
  });
  expect((await database.checklistItems.get("legacy-after-version"))?.enabled).toBe(true);
});

test("retains the lowest-ID flagged default even when canonical exists as a non-default", async () => {
  const database = createTestDb(`route-catalog-canonical-repair-${Date.now()}`);
  const retainedMembership = ["core-route-05", "core-route-02", "core-route-09"];
  await database.routeTemplates.bulkAdd([
    malformedRouteTemplate({ name: "规范默认模板", itemIds: ["core-route-03"] }),
    malformedRouteTemplate({ id: "a-extra-default", name: " 重名 ", itemIds: retainedMembership, isDefault: true }),
    malformedRouteTemplate({ id: "z-extra-default", name: "重名", isDefault: true }),
  ]);

  await initializeApp(createAppDependencies(database));

  const templates = await database.routeTemplates.toArray();
  expect(templates.filter((template) => template.isDefault)).toEqual([
    expect.objectContaining({ id: "a-extra-default" }),
  ]);
  expect(await database.routeTemplates.get("a-extra-default")).toMatchObject({
    name: "默认模板",
    isDefault: true,
    itemIds: retainedMembership,
  });
  expect(await database.routeTemplates.get("route-template-default")).toMatchObject({
    isDefault: false,
    itemIds: ["core-route-03"],
  });
  expect(await database.routeTemplates.get("z-extra-default")).toMatchObject({ isDefault: false });
  const normalizedNames = templates.map((template) => template.name.trim());
  expect(new Set(normalizedNames).size).toBe(templates.length);
});

test("retains the lowest-ID existing default when canonical is absent and demotes extras", async () => {
  const database = createTestDb(`route-catalog-existing-default-${Date.now()}`);
  await database.routeTemplates.bulkAdd([
    malformedRouteTemplate({ id: "z-default", name: "Z默认", isDefault: true }),
    malformedRouteTemplate({ id: "a-default", name: "A默认", isDefault: true }),
  ]);

  await initializeApp(createAppDependencies(database));

  expect(await database.routeTemplates.get("route-template-default")).toBeUndefined();
  expect(await database.routeTemplates.get("a-default")).toMatchObject({
    isDefault: true,
    itemIds: Array.from({ length: 39 }, (_, index) => `core-route-${String(index + 1).padStart(2, "0")}`),
  });
  expect(await database.routeTemplates.get("z-default")).toMatchObject({ isDefault: false });
});

test("reserves 默认模板 for the real default and renames a conflicting non-default", async () => {
  const database = createTestDb(`route-catalog-name-conflict-${Date.now()}`);
  const existing = malformedRouteTemplate({ id: "custom-default-name", isDefault: false });
  await database.routeTemplates.add(existing);

  await initializeApp(createAppDependencies(database));

  expect(await database.routeTemplates.get("custom-default-name")).toMatchObject({
    name: "默认模板（2）",
    isDefault: false,
  });
  expect(await database.routeTemplates.get("route-template-default")).toMatchObject({
    name: "默认模板",
    isDefault: true,
    itemIds: expect.any(Array),
  });
});

test("preserves disabled IDs and customized default membership across restart repair", async () => {
  const database = createTestDb(`route-catalog-disabled-reference-${Date.now()}`);
  await ensureRouteCatalog(database, "2026-07-29T00:00:00.000Z");
  await database.checklistItems.update("core-route-01", { enabled: false });
  const customizedIds = ["core-route-03", "core-route-01", "core-route-02"];
  await database.routeTemplates.update("route-template-default", { itemIds: customizedIds });

  await ensureRouteCatalog(database, "2026-07-30T00:00:00.000Z");

  expect((await database.routeTemplates.get("route-template-default"))?.itemIds).toEqual(customizedIds);
});

test("keeps an edited legacy built-in enabled while disabling untouched legacy rows", async () => {
  const database = createTestDb(`route-catalog-edited-legacy-${Date.now()}`);
  const [edited, untouched] = legacyItems.slice(0, 2);
  await database.checklistItems.bulkAdd([
    { ...edited, routeName: `${edited.routeName}（自定义）`, updatedAt: "2026-07-29T00:00:00.000Z" },
    untouched,
  ]);

  await ensureRouteCatalog(database, "2026-07-30T00:00:00.000Z");

  expect(await database.checklistItems.get(edited.id)).toMatchObject({
    routeName: `${edited.routeName}（自定义）`,
    enabled: true,
  });
  expect(await database.checklistItems.get(untouched.id)).toMatchObject({ enabled: false });
});

test("keeps the core name and renames an enabled edited legacy route that collides with it", async () => {
  const database = createTestDb(`route-catalog-name-collision-${Date.now()}`);
  const edited = legacyItems[0];
  await database.checklistItems.add({
    ...edited,
    routeName: "卷扬机间",
    standard: "用户修改后的检查标准",
    updatedAt: "2026-07-29T00:00:00.000Z",
  });

  await ensureRouteCatalog(database, "2026-07-30T00:00:00.000Z");

  expect(await database.checklistItems.get("core-route-01")).toMatchObject({
    routeName: "卷扬机间",
    enabled: true,
  });
  expect(await database.checklistItems.get(edited.id)).toMatchObject({
    routeName: "卷扬机间（2）",
    standard: "用户修改后的检查标准",
    enabled: true,
  });
  expect((await database.routeTemplates.get("route-template-default"))?.itemIds)
    .toContain("core-route-01");
});

test("upgrades a version-1 catalog by re-enabling edited legacy rows without changing references or history", async () => {
  const database = createTestDb(`route-catalog-v1-upgrade-${Date.now()}`);
  const [originalEdited, originalUntouched] = legacyItems.slice(0, 2);
  const edited = {
    ...originalEdited,
    routeName: `${originalEdited.routeName}（保留编辑）`,
    standard: "用户修改后的旧项点标准",
    enabled: false,
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
  await database.checklistItems.bulkAdd([
    edited,
    { ...originalUntouched, enabled: false, updatedAt: "2026-07-29T00:00:00.000Z" },
  ]);
  const templateIds = [edited.id, "core-route-02", originalUntouched.id];
  await database.routeTemplates.add(malformedRouteTemplate({ itemIds: templateIds }));
  await database.settings.put({
    key: "inspectionRouteCatalogVersion",
    value: 1,
    updatedAt: "2026-07-29T00:00:00.000Z",
  });
  const inspection = createInspection(
    [{ ...edited, enabled: true }],
    "v1-upgrade-history",
    "2026-07-29",
  );
  const historicalSnapshot = inspection.entries[0].itemSnapshot;
  await new InspectionRepository(database).saveGraph({ inspection, groups: [], photos: [] });

  await ensureRouteCatalog(database, "2026-07-30T00:00:00.000Z");

  expect(await database.checklistItems.get(edited.id)).toMatchObject({
    routeName: edited.routeName,
    standard: edited.standard,
    enabled: true,
  });
  expect(await database.checklistItems.get(originalUntouched.id)).toMatchObject({ enabled: false });
  expect((await database.routeTemplates.get("route-template-default"))?.itemIds).toEqual(templateIds);
  expect((await new InspectionRepository(database).getGraph(inspection.id))?.inspection.entries[0].itemSnapshot)
    .toEqual(historicalSnapshot);
  expect(await database.settings.get("inspectionRouteCatalogVersion")).toMatchObject({ value: 2 });
});

test("renames later recovered legacy routes when two edited v1 rows share a normalized name", async () => {
  const database = createTestDb(`route-catalog-v1-recovered-collision-${Date.now()}`);
  const [originalFirst, originalSecond] = legacyItems.slice(0, 2);
  const first = {
    ...originalFirst,
    routeName: "共享区域",
    standard: "第一条用户修改后的检查标准",
    enabled: false,
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
  const second = {
    ...originalSecond,
    routeName: " 共享区域 ",
    standard: "第二条用户修改后的检查标准",
    enabled: false,
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
  const occupiedDisabled = makeChecklistItem({
    id: "occupied-disabled-suffix",
    routeName: "共享区域（2）",
    enabled: false,
  });
  const templateIds = [second.id, first.id, occupiedDisabled.id];
  await database.checklistItems.bulkAdd([first, second, occupiedDisabled]);
  await database.routeTemplates.add(malformedRouteTemplate({ itemIds: templateIds }));
  await database.settings.put({
    key: "inspectionRouteCatalogVersion",
    value: 1,
    updatedAt: "2026-07-29T00:00:00.000Z",
  });
  const inspection = createInspection(
    [{ ...second, enabled: true }],
    "v1-recovered-collision-history",
    "2026-07-29",
  );
  const historicalSnapshot = inspection.entries[0].itemSnapshot;
  await new InspectionRepository(database).saveGraph({ inspection, groups: [], photos: [] });
  await database.templates.add(makeTemplate({ version: 2, name: "正式巡检通报模板" }));

  await ensureRouteCatalog(database, "2026-07-30T00:00:00.000Z");

  expect(await database.checklistItems.get(first.id)).toMatchObject({
    id: first.id,
    routeName: "共享区域",
    standard: first.standard,
    enabled: true,
  });
  expect(await database.checklistItems.get(second.id)).toMatchObject({
    id: second.id,
    routeName: "共享区域（3）",
    standard: second.standard,
    enabled: true,
  });
  const enabledRows = (await database.checklistItems.toArray()).filter((item) => item.enabled);
  expect(new Set(enabledRows.map((item) => item.routeName.trim())).size).toBe(enabledRows.length);
  expect((await database.routeTemplates.get("route-template-default"))?.itemIds).toEqual(templateIds);
  expect((await new InspectionRepository(database).getGraph(inspection.id))?.inspection.entries[0].itemSnapshot)
    .toEqual(historicalSnapshot);
  await expect(createBackup(database)).resolves.toBeTruthy();

  const afterUpgrade = (await database.checklistItems.toArray())
    .sort((left, right) => left.id.localeCompare(right.id));
  await ensureRouteCatalog(database, "2026-07-31T00:00:00.000Z");
  expect((await database.checklistItems.toArray()).sort((left, right) => left.id.localeCompare(right.id)))
    .toEqual(afterUpgrade);
});

test("keeps an enabled custom name and renames a colliding recovered legacy route", async () => {
  const database = createTestDb(`route-catalog-v1-custom-collision-${Date.now()}`);
  const original = legacyItems[0];
  const recovered = {
    ...original,
    routeName: " 共享区域 ",
    standard: "用户修改后需要恢复的旧项点标准",
    enabled: false,
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
  const custom = makeChecklistItem({
    id: "existing-enabled-custom-route",
    routeOrder: 999,
    routeName: "共享区域",
    standard: "现有自定义检查标准",
    enabled: true,
  });
  const templateIds = [recovered.id, custom.id];
  await database.checklistItems.bulkAdd([recovered, custom]);
  await database.routeTemplates.add(malformedRouteTemplate({ itemIds: templateIds }));
  await database.settings.put({
    key: "inspectionRouteCatalogVersion",
    value: 1,
    updatedAt: "2026-07-29T00:00:00.000Z",
  });
  const inspection = createInspection(
    [{ ...recovered, enabled: true }],
    "v1-custom-collision-history",
    "2026-07-29",
  );
  const historicalSnapshot = inspection.entries[0].itemSnapshot;
  await new InspectionRepository(database).saveGraph({ inspection, groups: [], photos: [] });
  await database.templates.add(makeTemplate({ version: 2, name: "正式巡检通报模板" }));

  await ensureRouteCatalog(database, "2026-07-30T00:00:00.000Z");

  expect(await database.checklistItems.get(custom.id)).toMatchObject({
    id: custom.id,
    routeName: "共享区域",
    standard: custom.standard,
    enabled: true,
  });
  expect(await database.checklistItems.get(recovered.id)).toMatchObject({
    id: recovered.id,
    routeName: "共享区域（2）",
    standard: recovered.standard,
    enabled: true,
  });
  const enabledRows = (await database.checklistItems.toArray()).filter((item) => item.enabled);
  expect(new Set(enabledRows.map((item) => item.routeName.trim())).size).toBe(enabledRows.length);
  expect((await database.routeTemplates.get("route-template-default"))?.itemIds).toEqual(templateIds);
  expect((await new InspectionRepository(database).getGraph(inspection.id))?.inspection.entries[0].itemSnapshot)
    .toEqual(historicalSnapshot);
  await expect(createBackup(database)).resolves.toBeTruthy();

  const afterUpgrade = (await database.checklistItems.toArray())
    .sort((left, right) => left.id.localeCompare(right.id));
  await ensureRouteCatalog(database, "2026-07-31T00:00:00.000Z");
  expect((await database.checklistItems.toArray()).sort((left, right) => left.id.localeCompare(right.id)))
    .toEqual(afterUpgrade);
});

test("rolls back core rows, settings, and malformed-default repairs when the repair write fails", async () => {
  const database = createTestDb(`route-catalog-repair-rollback-${Date.now()}`);
  const malformed = [
    malformedRouteTemplate(),
    malformedRouteTemplate({ id: "extra-default", name: "额外默认", isDefault: true }),
  ];
  await database.routeTemplates.bulkAdd(malformed);
  const write = vi.spyOn(database.routeTemplates, "bulkAdd")
    .mockRejectedValueOnce(new Error("模拟目录修复失败"));

  await expect(ensureRouteCatalog(database)).rejects.toThrow("模拟目录修复失败");

  expect(await database.checklistItems.count()).toBe(0);
  expect(await database.settings.count()).toBe(0);
  expect((await database.routeTemplates.toArray()).sort((left, right) => left.id.localeCompare(right.id)))
    .toEqual([...malformed].sort((left, right) => left.id.localeCompare(right.id)));
  write.mockRestore();
});

test("seeds immutable formal template v2 and binds new inspections without replacing v1", async () => {
  const database = createTestDb(`formal-template-${Date.now()}`);
  const dependencies = createAppDependencies(database);

  await initializeApp(dependencies);
  await initializeApp(dependencies);

  const repository = new TemplateRepository(database);
  const legacy = await repository.get("template-default", 1);
  const formal = await repository.get("template-default", 2);
  expect(legacy).toMatchObject({
    version: 1,
    openingText: "现将巡检情况通报如下。",
    bodyFont: "仿宋",
    marginMm: { top: 20, right: 20, bottom: 20, left: 20 },
  });
  expect(formal).toEqual({
    id: "template-default",
    version: 2,
    name: "正式巡检通报模板",
    titlePattern: "向塘钢轨焊接整修车间M月D日“7S”巡检通报",
    openingText: "为进一步规范车间现场作业秩序，强化安全生产基础管理、环境卫生管理，提高设备保养质量。持续深化整理、整顿、清扫、清洁、素养、安全、节约7S管理落地成效，切实消除焊轨作业现场安全隐患、提升生产作业标准化水平，车间管理人员定期对生产线各岗位进行“7S”巡检，主要检查车间全区域、各生产班组、关键作业工位、设备机房环境卫生、各岗位物品定制摆放、主要设备日常保养等情况。现将本次巡检发现的问题通报如下：",
    generalHeading: "一、“7S”巡检工作总体要求",
    requirements: [
      "原则上每周二、周四下午检查上一班次“7S”工作质量，如有变化另行通知。",
      "当班人员负责本岗位的设备保养擦拭工作。",
      "设备内部空间不得留存抹布、扫把等异物。",
      "周二、周四白班各岗位应对本岗位作业区域拖地清洁。",
      "“7S”执行较好的给予30-70元奖励；执行不到位的给予30-70元考核。",
      "除锈机、精磨机内部应清扫；其它设备内部擦拭。所有设备表面均应擦拭。",
      "设备周边地面环境卫生应保持干净整洁无杂物。",
      "各岗要按迎检标准对设备进行擦拭保养、周边环境（窗台、扶手、栏杆、安全通道等进行擦拭，地面地沟要拖地，岗位周边消防器材要擦拭）。",
      "各岗位设备下班后必须关机断电、开关插座需处于关闭状态、门窗需关好等。",
      "生产线停产期间，工班长也要合理安排岗位卫生清洁保养工作。",
    ],
    situationHeading: "二、本次检查总体情况",
    closingText: "请各工班严格落实现场“7S”管理的各项要求，班前班后做好设备擦拭保养，保持工作场所干净整洁、物品定置摆放到位，持续提升现场标准化管理水平。",
    organizationName: "向塘钢轨焊接整修车间",
    bodyFont: "宋体",
    headingFont: "黑体",
    titleFont: "方正小标宋简体",
    bodyFontSizePt: 12,
    titleFontSizePt: 18,
    lineSpacing: 1.5,
    firstLineIndentChars: 2,
    marginMm: { top: 20, right: 22, bottom: 20, left: 22 },
    photoLayoutMode: "fixed",
    photosPerRow: 3,
    sections: [
      { category: "good", title: "好的方面", order: 0 },
      { category: "reminder", title: "提醒问题", order: 1 },
      { category: "assessment", title: "考核问题", order: 2 },
    ],
    photoGapPt: 6,
    signatureDatePattern: "YYYY年M月D日",
  });
  expect(await database.templates.count()).toBe(2);
  expect(createInspection([makeChecklistItem()], "new-inspection", "2026-07-29")).toMatchObject({
    templateId: "template-default",
    templateVersion: 2,
  });
});

test("exposes one controlled report-generation path without raw packaging or status ports", () => {
  const dependencies = createAppDependencies(createTestDb(`report-service-port-${Date.now()}`));

  expect(typeof (dependencies.reportGenerator as unknown as Record<string, unknown>).generateReport).toBe("function");
  expect("generateDocx" in dependencies.reportGenerator).toBe(false);
  expect("markGeneratedAfterPackaging" in dependencies.inspectionRepository).toBe(false);
});
