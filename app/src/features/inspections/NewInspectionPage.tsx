import { CheckSquare, Play, Plus, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppDependencies } from "../../app/useAppDependencies";
import { createInspection } from "../../domain/inspection";
import { createCustomChecklistItem } from "../../domain/customChecklistItem";
import type { ChecklistItem, InspectionRouteTemplate } from "../../domain/models";
import { deduplicateEnabledRouteItems } from "../../domain/routeNames";
import { createBrowserUuid } from "../../lib/ids";
import { toLocalInspectionDate } from "../../lib/dates";
import { ChecklistRouteList, type ChecklistRoute } from "./ChecklistRouteList";
import { CustomRouteDialog } from "./CustomRouteDialog";

interface LoadedRouteData {
  items: ChecklistItem[];
  templates: InspectionRouteTemplate[];
}

function checklistRoutes(items: ChecklistItem[]): ChecklistRoute[] {
  return items.map((item) => ({ id: item.id, name: item.routeName }));
}

function orderedEnabledItems(
  template: InspectionRouteTemplate | undefined,
  items: ChecklistItem[],
): ChecklistItem[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const templateIds = new Set(template?.itemIds ?? []);
  return deduplicateEnabledRouteItems([
    ...(template?.itemIds ?? []).map((itemId) => itemsById.get(itemId)).filter((item): item is ChecklistItem => item !== undefined),
    ...items.filter((item) => !templateIds.has(item.id)),
  ]);
}

function validTemplateItemIds(template: InspectionRouteTemplate | undefined, items: ChecklistItem[]): Set<string> {
  if (!template) return new Set();
  const enabledIds = new Set(orderedEnabledItems(template, items).map((item) => item.id));
  return new Set(template.itemIds.filter((itemId) => enabledIds.has(itemId)));
}

function defaultTemplateId(templates: InspectionRouteTemplate[]): string {
  return templates.find((template) => template.isDefault)?.id ?? "";
}

const LAST_USED_ROUTE_TEMPLATE_KEY = "lastUsedRouteTemplateId";

function readLastUsedTemplateId(): string {
  try {
    return window.localStorage.getItem(LAST_USED_ROUTE_TEMPLATE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastUsedTemplateId(templateId: string): void {
  try {
    window.localStorage.setItem(LAST_USED_ROUTE_TEMPLATE_KEY, templateId);
  } catch {
    // 存储不可用（如隐私模式）时静默跳过，不影响本次选择。
  }
}

export function NewInspectionPage() {
  const { itemRepository, inspectionRepository, routeTemplateRepository, templateRepository, createInspectionId, now } = useAppDependencies();
  const navigate = useNavigate();
  const selectedTemplateIdRef = useRef("");
  const loadGenerationRef = useRef(0);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [templates, setTemplates] = useState<InspectionRouteTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [templateWarning, setTemplateWarning] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCustomRouteOpen, setIsCustomRouteOpen] = useState(false);
  const [customRouteTemplateId, setCustomRouteTemplateId] = useState("");
  const customRouteOpenerRef = useRef<HTMLButtonElement>(null);

  const loadRouteData = useCallback(async (): Promise<LoadedRouteData> => {
    const [enabledItems, savedTemplates] = await Promise.all([
      itemRepository.listEnabled(),
      routeTemplateRepository.list(),
    ]);
    return { items: enabledItems, templates: savedTemplates };
  }, [itemRepository, routeTemplateRepository]);

  const applyLoadedRouteData = useCallback((data: LoadedRouteData, initializeSelection: boolean) => {
    const currentTemplateExists = data.templates.some((template) => template.id === selectedTemplateIdRef.current);
    const lastUsedId = readLastUsedTemplateId();
    const lastUsedExists = data.templates.some((template) => template.id === lastUsedId);
    const nextTemplateId = currentTemplateExists
      ? selectedTemplateIdRef.current
      : lastUsedExists
        ? lastUsedId
        : defaultTemplateId(data.templates);
    const nextTemplate = data.templates.find((template) => template.id === nextTemplateId);
    const nextSelection = validTemplateItemIds(nextTemplate, data.items);
    const enabledItemIds = new Set(data.items.map((item) => item.id));

    setItems(data.items);
    setTemplates(data.templates);
    selectedTemplateIdRef.current = nextTemplateId;
    setSelectedTemplateId(nextTemplateId);
    if (initializeSelection || !currentTemplateExists) {
      setSelectedItemIds(nextSelection);
    } else {
      setSelectedItemIds((current) => new Set([...current].filter((itemId) => enabledItemIds.has(itemId))));
    }
    setTemplateWarning(
      nextTemplate && nextSelection.size !== nextTemplate.itemIds.length
        ? "模板中有项目已停用，本次已自动忽略。"
        : "",
    );
    setLoadError("");
  }, []);

  const loadAndApplyRouteData = useCallback(async (initializeSelection: boolean) => {
    const generation = ++loadGenerationRef.current;
    setIsLoading(true);
    try {
      const data = await loadRouteData();
      if (generation === loadGenerationRef.current) applyLoadedRouteData(data, initializeSelection);
    } catch {
      if (generation === loadGenerationRef.current) setLoadError("加载失败");
    } finally {
      if (generation === loadGenerationRef.current) setIsLoading(false);
    }
  }, [applyLoadedRouteData, loadRouteData]);

  useEffect(() => {
    void loadAndApplyRouteData(true);
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [loadAndApplyRouteData]);

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const orderedItems = useMemo(
    () => orderedEnabledItems(selectedTemplate, items),
    [items, selectedTemplate],
  );
  const routes = useMemo(() => checklistRoutes(orderedItems), [orderedItems]);

  function selectTemplate(templateId: string) {
    const template = templates.find((candidate) => candidate.id === templateId);
    const nextSelection = validTemplateItemIds(template, items);
    selectedTemplateIdRef.current = templateId;
    setSelectedTemplateId(templateId);
    setSelectedItemIds(nextSelection);
    writeLastUsedTemplateId(templateId);
    setTemplateWarning(
      template && nextSelection.size !== template.itemIds.length
        ? "模板中有项目已停用，本次已自动忽略。"
        : "",
    );
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function retryLoad() {
    if (isLoading) return;
    await loadAndApplyRouteData(false);
  }

  function openCustomRouteDialog() {
    if (!selectedTemplateId || isSaving) return;
    setCustomRouteTemplateId(selectedTemplateId);
    setIsCustomRouteOpen(true);
  }

  function closeCustomRouteDialog() {
    setIsCustomRouteOpen(false);
    setCustomRouteTemplateId("");
  }

  async function addCustomRoute(templateId: string, routeName: string) {
    if (!templateId || isSaving) throw new Error("请先选择检查路线模板。");
    const timestamp = now().toISOString();
    const result = await routeTemplateRepository.addCustomItem(
      templateId,
      createCustomChecklistItem(routeName, `custom-route-${createBrowserUuid()}`, timestamp),
    );

    setItems((current) => [...current, result.item].sort(
      (left, right) => left.routeOrder - right.routeOrder || left.id.localeCompare(right.id),
    ));
    setTemplates((current) => [...current.filter((template) => template.id !== result.template.id), result.template].sort(
      (left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name),
    ));
    setSelectedItemIds((current) => new Set([...current, result.item.id]));
    closeCustomRouteDialog();
  }

  async function startInspection() {
    if (selectedItemIds.size === 0 || isSaving) return;
    setIsSaving(true);
    try {
      const enabledItemsById = new Map(
        (await itemRepository.listEnabled()).map((item) => [item.id, item]),
      );
      const selectedItems = deduplicateEnabledRouteItems(orderedItems
        .filter((item) => selectedItemIds.has(item.id))
        .map((item) => enabledItemsById.get(item.id))
        .filter((item): item is ChecklistItem => item !== undefined));
      if (selectedItems.length === 0) {
        throw new Error("所选巡检项目已停用或不存在。");
      }
      const inspectionId = createInspectionId();
      const inspectionDate = toLocalInspectionDate(now());
      const inspection = createInspection(selectedItems, inspectionId, inspectionDate);
      const template = await templateRepository.getLatest("template-default");
      if (template) {
        inspection.templateId = template.id;
        inspection.templateVersion = template.version;
      }
      await inspectionRepository.saveGraph({ inspection, groups: [], photos: [] });
      navigate(`/inspections/${inspectionId}`);
    } catch {
      setLoadError("巡检草稿保存失败，请重试。");
      setIsSaving(false);
    }
  }

  return (
    <section className="page-section new-inspection-page">
      <div className="section-heading">
        <p className="eyebrow">新建巡检</p>
        <h2>选择巡检路线</h2>
      </div>
      {loadError ? (
        <div className="inline-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="secondary-action" disabled={isLoading} onClick={() => void retryLoad()}>重新加载</button>
        </div>
      ) : null}
      <div className="new-inspection-template-controls">
        <label>
          检查路线模板
          <select
            aria-label="检查路线模板"
            value={selectedTemplateId}
            disabled={templates.length === 0 || isSaving || isCustomRouteOpen}
            onChange={(event) => selectTemplate(event.target.value)}
          >
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </label>
        <Link to="/inspections/route-templates">管理路线模板</Link>
      </div>
      {templateWarning ? <p className="storage-warning" role="status">{templateWarning}</p> : null}
      <div className="route-selection-toolbar" aria-label="路线选择操作">
        <span>已选择 {selectedItemIds.size} 项</span>
        <div>
          <button type="button" className="secondary-action" disabled={isSaving || isCustomRouteOpen || orderedItems.length === 0} onClick={() => setSelectedItemIds(new Set(orderedItems.map((item) => item.id)))}>
            <CheckSquare aria-hidden="true" size={18} />全选
          </button>
          <button type="button" className="secondary-action" disabled={isSaving || isCustomRouteOpen || orderedItems.length === 0} onClick={() => setSelectedItemIds(new Set())}>
            <Square aria-hidden="true" size={18} />全不选
          </button>
          <button ref={customRouteOpenerRef} type="button" className="secondary-action" disabled={isSaving || isCustomRouteOpen || !selectedTemplateId} onClick={openCustomRouteDialog}>
            <Plus aria-hidden="true" size={18} />增加自定义
          </button>
        </div>
      </div>
      <ChecklistRouteList
        routes={routes}
        selectedItemIds={selectedItemIds}
        onToggle={toggleItem}
      />
      <div className="page-command-bar">
        <span>{selectedItemIds.size} 项</span>
        <button
          type="button"
          className="primary-action"
          disabled={selectedItemIds.size === 0 || isSaving || isCustomRouteOpen}
          onClick={startInspection}
        >
          <Play aria-hidden="true" size={19} fill="currentColor" />
          {isSaving ? "正在保存" : "开始检查"}
        </button>
      </div>
      {isCustomRouteOpen ? (
        <CustomRouteDialog
          openerRef={customRouteOpenerRef}
          onCancel={closeCustomRouteDialog}
          onSave={(routeName) => addCustomRoute(customRouteTemplateId, routeName)}
        />
      ) : null}
    </section>
  );
}
