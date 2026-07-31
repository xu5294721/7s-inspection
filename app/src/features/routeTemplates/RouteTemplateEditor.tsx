import { ArrowDown, ArrowUp, CheckSquare, Plus, Square } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ChecklistItem, InspectionRouteTemplate } from "../../domain/models";
import { normalizeRouteName } from "../../domain/routeNames";
import { CustomRouteDialog } from "../inspections/CustomRouteDialog";

export interface RouteTemplateDraft {
  name: string;
  itemIds: string[];
  customItems: ChecklistItem[];
}

interface RouteTemplateEditorProps {
  template: InspectionRouteTemplate | null;
  items: ChecklistItem[];
  onCancel(): void;
  onCreateCustomItem(routeName: string): ChecklistItem;
  onSave(draft: RouteTemplateDraft): Promise<void>;
}

export function RouteTemplateEditor({
  template,
  items,
  onCancel,
  onCreateCustomItem,
  onSave,
}: RouteTemplateEditorProps) {
  const isDefault = template?.isDefault ?? false;
  const [name, setName] = useState(template?.name ?? "");
  const [customItems, setCustomItems] = useState<ChecklistItem[]>([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set(
    (template?.itemIds ?? []).filter((itemId) => items.some((item) => item.id === itemId)),
  ));
  const [orderedIds, setOrderedIds] = useState(() =>
    (template?.itemIds ?? []).filter((itemId) => items.some((item) => item.id === itemId)),
  );
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCustomDialogOpen, setIsCustomDialogOpen] = useState(false);
  const customRouteOpenerRef = useRef<HTMLButtonElement>(null);
  const availableItems = useMemo(() => [...items, ...customItems], [customItems, items]);
  const availableItemsById = useMemo(
    () => new Map(availableItems.map((item) => [item.id, item])),
    [availableItems],
  );
  const normalizedName = name.trim();
  const canSave = normalizedName.length > 0 && selectedIds.size > 0 && !isSaving;
  const selectedCount = selectedIds.size;
  const adjustedForDisabledItems = Boolean(
    template && template.itemIds.some((itemId) => !items.some((item) => item.id === itemId)),
  );
  const orderedItemIds = useMemo(
    () => orderedIds.filter((itemId) => selectedIds.has(itemId) && availableItemsById.has(itemId)),
    [availableItemsById, orderedIds, selectedIds],
  );
  const orderedItems = useMemo(
    () => orderedItemIds.map((itemId) => availableItemsById.get(itemId)).filter(
      (item): item is ChecklistItem => item !== undefined,
    ),
    [availableItemsById, orderedItemIds],
  );

  function toggleItem(itemId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
        setOrderedIds((currentOrder) => currentOrder.filter((id) => id !== itemId));
      } else {
        next.add(itemId);
        setOrderedIds((currentOrder) => [...currentOrder.filter((id) => id !== itemId), itemId]);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(availableItems.map((item) => item.id)));
    setOrderedIds(availableItems.map((item) => item.id));
  }

  function clearAll() {
    setSelectedIds(new Set());
    setOrderedIds([]);
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    setOrderedIds((current) => {
      const index = current.indexOf(itemId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function addCustomItem(routeName: string) {
    const normalizedRouteName = normalizeRouteName(routeName);
    if (availableItems.some((item) => normalizeRouteName(item.routeName) === normalizedRouteName)) {
      throw new Error("检查项目名称已存在。");
    }
    const item = onCreateCustomItem(routeName);
    setCustomItems((current) => [...current, item]);
    setSelectedIds((current) => new Set([...current, item.id]));
    setOrderedIds((current) => [...current, item.id]);
    setIsCustomDialogOpen(false);
  }

  async function save() {
    if (!canSave) return;
    setError("");
    setIsSaving(true);
    try {
      await onSave({
        name: isDefault ? template?.name ?? "" : normalizedName,
        itemIds: orderedItemIds,
        customItems,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存模板失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="page-section route-template-editor">
      <div className="section-heading">
        <p className="eyebrow">巡检路线维护</p>
        <h2>{template ? "编辑路线模板" : "新建路线模板"}</h2>
      </div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {adjustedForDisabledItems ? (
        <p className="storage-warning" role="status">模板中有项目已停用，本次已自动忽略。</p>
      ) : null}
      <div className="form-grid">
        <label>
          模板名称
          <input
            aria-label="模板名称"
            disabled={isDefault || isSaving}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>
      {isDefault ? <p className="route-template-editor__hint">默认模板名称不可修改，可调整包含的巡检路线。</p> : null}
      <div className="route-template-editor__toolbar" aria-label="路线选择操作">
        <span>已选择 {selectedCount} 条路线</span>
        <div>
          <button type="button" className="secondary-action" disabled={isSaving} onClick={selectAll}>
            <CheckSquare aria-hidden="true" size={18} />全选
          </button>
          <button type="button" className="secondary-action" disabled={isSaving} onClick={clearAll}>
            <Square aria-hidden="true" size={18} />全不选
          </button>
          <button
            ref={customRouteOpenerRef}
            type="button"
            className="secondary-action"
            disabled={isSaving}
            onClick={() => setIsCustomDialogOpen(true)}
          >
            <Plus aria-hidden="true" size={18} />新增检查项
          </button>
        </div>
      </div>
      {selectedCount > 0 ? (
        <div className="route-template-editor__selected">
          <h3>已选路线顺序</h3>
          <ol>
            {orderedItems.map((item, index) => (
              <li key={item.id}>
                <span>{item.routeName}</span>
                <span>
                  <button
                    type="button"
                    aria-label={`上移 ${item.routeName}`}
                    title="上移"
                    disabled={isSaving || index === 0}
                    onClick={() => moveItem(item.id, -1)}
                  >
                    <ArrowUp aria-hidden="true" size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`下移 ${item.routeName}`}
                    title="下移"
                    disabled={isSaving || index === orderedItems.length - 1}
                    onClick={() => moveItem(item.id, 1)}
                  >
                    <ArrowDown aria-hidden="true" size={17} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <ul className="route-template-editor__routes">
        {availableItems.map((item) => (
          <li key={item.id}>
            <label className="route-template-option">
              <input
                type="checkbox"
                aria-label={item.routeName}
                checked={selectedIds.has(item.id)}
                disabled={isSaving}
                onChange={() => toggleItem(item.id)}
              />
              <span>{item.routeName}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="route-template-editor__actions">
        <button type="button" className="secondary-action" disabled={isSaving} onClick={onCancel}>取消</button>
        <button type="button" className="primary-action" disabled={!canSave} onClick={() => void save()}>
          {isSaving ? "正在保存" : "保存模板"}
        </button>
      </div>
      {isCustomDialogOpen ? (
        <CustomRouteDialog
          openerRef={customRouteOpenerRef}
          title="新增检查项"
          fieldLabel="检查项目名称"
          onCancel={() => setIsCustomDialogOpen(false)}
          onSave={addCustomItem}
        />
      ) : null}
    </section>
  );
}
