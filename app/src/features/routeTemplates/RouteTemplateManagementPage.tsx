import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDependencies } from "../../app/useAppDependencies";
import { createCustomChecklistItem } from "../../domain/customChecklistItem";
import { normalizeRouteName } from "../../domain/routeNames";
import type { ChecklistItem, InspectionRouteTemplate } from "../../domain/models";
import { createBrowserUuid } from "../../lib/ids";
import { RouteTemplateEditor, type RouteTemplateDraft } from "./RouteTemplateEditor";

function sortTemplates(templates: InspectionRouteTemplate[]): InspectionRouteTemplate[] {
  return [...templates].sort(
    (left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name),
  );
}

export function RouteTemplateManagementPage() {
  const { itemRepository, now, routeTemplateRepository } = useAppDependencies();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [templates, setTemplates] = useState<InspectionRouteTemplate[]>([]);
  const [editing, setEditing] = useState<InspectionRouteTemplate | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<InspectionRouteTemplate | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const deleteOpenerRef = useRef<HTMLElement | null>(null);
  const isDeletingRef = useRef(false);
  isDeletingRef.current = isDeleting;

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [enabledItems, savedTemplates] = await Promise.all([
        itemRepository.listEnabled(),
        routeTemplateRepository.list(),
      ]);
      setItems(enabledItems);
      setTemplates(sortTemplates(savedTemplates));
      setLoadError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "路线模板加载失败，请重试。";
      setLoadError(message);
      throw cause;
    } finally {
      setIsLoading(false);
    }
  }, [itemRepository, routeTemplateRepository]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    if (!pendingDelete) return;
    cancelButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeletingRef.current) {
        event.preventDefault();
        setPendingDelete(null);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      deleteOpenerRef.current?.focus();
      deleteOpenerRef.current = null;
    };
  }, [pendingDelete]);

  useEffect(() => {
    if (!pendingDelete) return;
    if (isDeleting) dialogRef.current?.focus();
    else if (error) cancelButtonRef.current?.focus();
  }, [error, isDeleting, pendingDelete]);

  async function saveTemplate(draft: RouteTemplateDraft) {
    const timestamp = now().toISOString();
    const template: InspectionRouteTemplate = editing
      ? {
        ...editing,
        name: editing.isDefault ? editing.name : draft.name,
        itemIds: draft.itemIds,
        updatedAt: timestamp,
      }
      : {
        id: `route-template-${createBrowserUuid()}`,
        name: draft.name,
        itemIds: draft.itemIds,
        isDefault: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    const selectedCustomItems = draft.customItems.filter((item) => draft.itemIds.includes(item.id));
    const result = selectedCustomItems.length > 0
      ? await routeTemplateRepository.saveWithCustomItems(template, selectedCustomItems)
      : (await routeTemplateRepository.save(template), { template, items: [] });
    if (result.items.length > 0) {
      setItems((current) => [...current, ...result.items].sort(
        (left, right) => left.routeOrder - right.routeOrder || left.id.localeCompare(right.id),
      ));
    }
    setTemplates((current) => sortTemplates([
      ...current.filter((existing) => existing.id !== result.template.id),
      result.template,
    ]));
    setEditing(undefined);
  }

  function createCustomItem(routeName: string): ChecklistItem {
    const normalizedName = normalizeRouteName(routeName);
    if (items.some((item) => normalizeRouteName(item.routeName) === normalizedName)) {
      throw new Error("检查项目名称已存在。");
    }
    return createCustomChecklistItem(routeName, `custom-route-${createBrowserUuid()}`, now().toISOString());
  }

  function openDelete(template: InspectionRouteTemplate, opener: HTMLElement) {
    deleteOpenerRef.current = opener;
    setError("");
    setPendingDelete(template);
  }

  async function removeTemplate() {
    if (!pendingDelete || isDeleting) return;
    setIsDeleting(true);
    setError("");
    try {
      await routeTemplateRepository.remove(pendingDelete.id);
      setTemplates((current) => current.filter((template) => template.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除模板失败，请重试。");
    } finally {
      setIsDeleting(false);
    }
  }

  if (editing !== undefined) {
    return (
      <RouteTemplateEditor
        template={editing}
        items={items}
        onCancel={() => setEditing(undefined)}
        onCreateCustomItem={createCustomItem}
        onSave={saveTemplate}
      />
    );
  }

  return (
    <section className="page-section route-template-management-page">
      <div className="section-heading">
        <p className="eyebrow">巡检路线维护</p>
        <h2>路线模板</h2>
      </div>
      <button type="button" className="primary-action" onClick={() => setEditing(null)}>
        <Plus aria-hidden="true" size={18} />新建模板
      </button>
      {loadError ? <div className="route-template-load-error"><p className="inline-error" role="alert">{loadError}</p><button type="button" className="secondary-action" disabled={isLoading} onClick={() => void reload().catch(() => undefined)}>重新加载</button></div> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <ul className="route-template-list">
        {templates.map((template) => (
          <li key={template.id}>
            <div className="route-template-list__summary">
              <strong>{template.name}</strong>
              <span>{template.isDefault ? "默认模板" : "自定义模板"} · {template.itemIds.length} 条路线</span>
            </div>
            <div className="route-template-list__actions">
              <button type="button" aria-label={`编辑 ${template.name}`} onClick={() => setEditing(template)}>
                <Pencil aria-hidden="true" size={18} />编辑
              </button>
              {!template.isDefault ? (
                <button type="button" aria-label={`删除 ${template.name}`} onClick={(event) => openDelete(template, event.currentTarget)}>
                  <Trash2 aria-hidden="true" size={18} />删除
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {templates.length === 0 ? <p className="empty-state">暂无路线模板。</p> : null}
      {pendingDelete ? (
        <div className="confirmation-backdrop">
          <section ref={dialogRef} className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="route-template-delete-title" aria-busy={isDeleting} tabIndex={-1}>
            <h3 id="route-template-delete-title">确认删除模板</h3>
            <p>删除“{pendingDelete.name}”后无法恢复，不影响已创建的巡检记录。</p>
            <div>
              <button ref={cancelButtonRef} type="button" disabled={isDeleting} onClick={() => setPendingDelete(null)}>取消</button>
              <button type="button" className="danger-action" disabled={isDeleting} onClick={() => void removeTemplate()}>确认删除</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
