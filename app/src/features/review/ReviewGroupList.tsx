import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { formatInspectionEvaluationDescription } from "../../domain/inspectionCheckContents";
import type { InspectionEntry, PhotoAsset, PhotoGroup, ReportValidationError } from "../../domain/models";

interface Props {
  groups: PhotoGroup[];
  photos: PhotoAsset[];
  entries: InspectionEntry[];
  errors: ReportValidationError[];
  registerGroup(id: string, element: HTMLElement | null): void;
  onGroupReorder(ids: string[]): void;
  onPhotoReorder(groupId: string, ids: string[]): void;
  onAssessmentChange(group: PhotoGroup, people: string, amountInput: string): void;
}

export function ReviewGroupList(props: Props) {
  return (
    <SortableContext items={props.groups.map((group) => group.id)} strategy={verticalListSortingStrategy}>
      <div className="review-group-list">
        {props.groups.map((group) => (
          <SortableGroup key={group.id} group={group} {...props} />
        ))}
      </div>
    </SortableContext>
  );
}

function SortableGroup({
  group,
  photos,
  entries,
  errors,
  registerGroup,
  onPhotoReorder,
  onAssessmentChange,
}: Props & { group: PhotoGroup }) {
  const sortable = useSortable({ id: group.id, data: { type: "group", category: group.category } });
  const [people, setPeople] = useState(group.awardAssessment?.people ?? "");
  const [amount, setAmount] = useState(group.awardAssessment?.amount ? String(group.awardAssessment.amount) : "");
  const groupPhotos = group.photoIds
    .map((id) => photos.find((photo) => photo.id === id))
    .filter((photo): photo is PhotoAsset => Boolean(photo));
  const entry = entries.find((item) => item.id === group.entryId);
  const selectedDescription = entry
    ? formatInspectionEvaluationDescription(entry.itemSnapshot.routeName, entry.checkSelections ?? [])
    : "";
  const groupErrors = errors.filter((error) => error.groupId === group.id);

  useEffect(() => {
    setPeople(group.awardAssessment?.people ?? "");
    setAmount(group.awardAssessment?.amount ? String(group.awardAssessment.amount) : "");
  }, [group.awardAssessment]);

  function photoDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = group.photoIds.indexOf(String(event.active.id));
    const newIndex = group.photoIds.indexOf(String(event.over.id));
    onPhotoReorder(group.id, arrayMove(group.photoIds, oldIndex, newIndex));
  }

  return (
    <article
      ref={(element) => { sortable.setNodeRef(element); registerGroup(group.id, element); }}
      className="review-group"
      data-testid={`review-group-${group.id}`}
      tabIndex={-1}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
    >
      <header className="review-group__header">
        <div>
          <strong>{entry?.itemSnapshot.part || "未命名项点"}</strong>
          <span>{entry?.itemSnapshot.routeName}</span>
        </div>
        <button type="button" className="drag-handle" aria-label={`拖动照片组 ${group.id}`} {...sortable.attributes} {...sortable.listeners}>
          <GripVertical aria-hidden="true" size={20} />
        </button>
      </header>
      <p>{group.descriptionManuallyEdited ? group.description : selectedDescription || group.description}</p>
      {group.category === "assessment" ? (
        <div className="review-assessment-fields">
          <label>考核人员<input aria-label="考核人员" value={people} onChange={(event) => { const value = event.currentTarget.value; setPeople(value); onAssessmentChange(group, value, amount); }} /></label>
          <label>考核金额<input aria-label="考核金额" type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(event) => { const value = event.currentTarget.value; setAmount(value); onAssessmentChange(group, people, value); }} /></label>
        </div>
      ) : null}
      {groupErrors.map((item) => <p className="inline-error" key={`${item.code}-${item.field}`}>{item.message}</p>)}
      <DndContext sensors={useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))} collisionDetection={closestCenter} onDragEnd={photoDragEnd}>
        <SortableContext items={group.photoIds} strategy={verticalListSortingStrategy}>
          <div className="review-photo-list">
            {groupPhotos.map((photo) => <SortablePhoto key={photo.id} photo={photo} />)}
          </div>
        </SortableContext>
      </DndContext>
    </article>
  );
}

function SortablePhoto({ photo }: { photo: PhotoAsset }) {
  const sortable = useSortable({ id: photo.id });
  const [source, setSource] = useState<string>();
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    try {
      const url = URL.createObjectURL(photo.thumbnailBlob);
      setSource(url);
      return () => URL.revokeObjectURL(url);
    } catch {
      setSource(undefined);
    }
  }, [photo.thumbnailBlob]);
  return (
    <div ref={sortable.setNodeRef} className="review-photo" style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
      <img {...(source ? { src: source } : {})} alt={`巡检照片 ${photo.id}`} />
      <button type="button" aria-label={`拖动照片 ${photo.id}`} {...sortable.attributes} {...sortable.listeners}><GripVertical aria-hidden="true" size={18} /></button>
    </div>
  );
}
