import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useState } from "react";
import type { PhotoCategory, ReviewRouteOrderByCategory } from "../../domain/models";

const categories: Array<{ id: PhotoCategory; label: string }> = [
  { id: "good", label: "好的方面" },
  { id: "reminder", label: "提醒问题" },
  { id: "assessment", label: "考核问题" },
];

interface ReviewRouteSortDialogProps {
  routeNamesByCategory: Record<PhotoCategory, string[]>;
  onSave(routeOrderByCategory: ReviewRouteOrderByCategory): Promise<void> | void;
  onCancel(): void;
}

export function ReviewRouteSortDialog({ routeNamesByCategory, onSave, onCancel }: ReviewRouteSortDialogProps) {
  const [orderedRouteNames, setOrderedRouteNames] = useState<Record<PhotoCategory, string[]>>(() => ({
    good: [...routeNamesByCategory.good],
    reminder: [...routeNamesByCategory.reminder],
    assessment: [...routeNamesByCategory.assessment],
  }));
  const [saving, setSaving] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function dragEnd(category: PhotoCategory, event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = orderedRouteNames[category].indexOf(String(event.active.id));
    const newIndex = orderedRouteNames[category].indexOf(String(event.over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setOrderedRouteNames((current) => ({
      ...current,
      [category]: arrayMove(current[category], oldIndex, newIndex),
    }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({
        good: [...orderedRouteNames.good],
        reminder: [...orderedRouteNames.reminder],
        assessment: [...orderedRouteNames.assessment],
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="review-route-dialog-backdrop">
      <section className="review-route-sort-dialog" role="dialog" aria-modal="true" aria-label="项点排序">
        <header className="review-route-dialog__header"><h3>项点排序</h3></header>
        <div className="review-route-dialog__body">
          {categories.map(({ id, label }) => (
            <section className="review-route-sort-dialog__section" key={id} aria-label={label}>
              <h4>{label}</h4>
              {orderedRouteNames[id].length === 0 ? <p>暂无已拍照项点</p> : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => dragEnd(id, event)}>
                  <SortableContext items={orderedRouteNames[id]} strategy={verticalListSortingStrategy}>
                    <div className="review-route-sort-dialog__list">
                      {orderedRouteNames[id].map((routeName) => (
                        <SortableRouteName key={routeName} routeName={routeName} category={id} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </section>
          ))}
        </div>
        <footer className="review-route-dialog__command">
          <button type="button" className="secondary-action" disabled={saving} onClick={onCancel}>取消</button>
          <button type="button" className="primary-action" disabled={saving} onClick={() => void save()}>{saving ? "正在保存" : "保存排序"}</button>
        </footer>
      </section>
    </div>
  );
}

function SortableRouteName({ routeName, category }: { routeName: string; category: PhotoCategory }) {
  const sortable = useSortable({ id: routeName });
  return (
    <div
      ref={sortable.setNodeRef}
      className="review-route-sort-dialog__item"
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
    >
      <button type="button" className="drag-handle" aria-label={`拖动${category}项点 ${routeName}`} {...sortable.attributes} {...sortable.listeners}>
        <GripVertical aria-hidden="true" size={20} />
      </button>
      <span>{routeName}</span>
    </div>
  );
}
