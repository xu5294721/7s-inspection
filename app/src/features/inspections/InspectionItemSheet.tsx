import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  ChecklistItem,
  InspectionCheckSelection,
  InspectionEntry,
  PhotoAsset,
  PhotoCategory,
  PhotoGroup,
} from "../../domain/models";
import { InspectionEntryEditor } from "./InspectionEntryEditor";
import type { PhotoInputSource } from "../photos/PhotoCaptureButtons";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export interface InspectionItemSheetProps {
  entry: InspectionEntry;
  groups: PhotoGroup[];
  photos: PhotoAsset[];
  checklistItem: ChecklistItem;
  disabled: boolean;
  onClose(): void;
  onComplete(): void;
  onFilesSelected(files: File[], source: PhotoInputSource): void;
  onSaveCheckSelections(selections: InspectionCheckSelection[]): Promise<void>;
  onCreatePhotoGroup(category: PhotoCategory): Promise<void>;
  onSavePhotoGroup(group: PhotoGroup): Promise<void>;
  onSplit(group: PhotoGroup, photoId: string, category: PhotoCategory): Promise<void>;
  onPhotoSave(photo: PhotoAsset): Promise<void>;
  onDeletePhoto(photoId: string): void;
  onReplacePhoto(photo: PhotoAsset, file: File, source: PhotoInputSource): void;
  onHighQualityChange(photo: PhotoAsset, highQuality: boolean): void;
}

export function InspectionItemSheet({
  entry,
  groups,
  photos,
  checklistItem,
  disabled,
  onClose,
  onComplete,
  onFilesSelected,
  onSaveCheckSelections,
  onCreatePhotoGroup,
  onSavePhotoGroup,
  onSplit,
  onPhotoSave,
  onDeletePhoto,
  onReplacePhoto,
  onHighQualityChange,
}: InspectionItemSheetProps) {
  const titleId = `inspection-item-sheet-title-${entry.id}`;
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  onCloseRef.current = onClose;
  disabledRef.current = disabled;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const sheet = dialog;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (disabledRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(sheet);
      if (focusable.length === 0) {
        event.preventDefault();
        sheet.focus();
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

    sheet.addEventListener("keydown", handleKeyDown);
    (closeButtonRef.current ?? focusableElements(sheet)[0] ?? sheet).focus();
    return () => sheet.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="inspection-item-sheet__backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="inspection-item-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`检查项：${entry.itemSnapshot.routeName}`}
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="inspection-item-sheet__header">
          <div>
            <p className="eyebrow">当前项点</p>
            <h3 id={titleId}>检查项：{entry.itemSnapshot.routeName}</h3>
            <p>{[entry.itemSnapshot.part, entry.itemSnapshot.area, entry.itemSnapshot.device].filter(Boolean).join(" · ")}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="icon-button" aria-label="关闭项点卡片" disabled={disabled} onClick={onClose}>
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="inspection-item-sheet__body">
          <ul className="inspection-entry-list inspection-item-sheet__editor-list">
            <InspectionEntryEditor
              entry={entry}
              groups={groups}
              photos={photos}
              checklistItem={checklistItem}
              disabled={disabled}
              onFilesSelected={onFilesSelected}
              onSaveCheckSelections={onSaveCheckSelections}
              onCreatePhotoGroup={onCreatePhotoGroup}
              onSavePhotoGroup={onSavePhotoGroup}
              onSplit={onSplit}
              onPhotoSave={onPhotoSave}
              onDeletePhoto={onDeletePhoto}
              onReplacePhoto={onReplacePhoto}
              onHighQualityChange={onHighQualityChange}
            />
          </ul>
        </div>
        <footer className="inspection-item-sheet__footer">
          <button type="button" className="secondary-action" disabled={disabled} onClick={onClose}>暂存并关闭</button>
          <button type="button" className="primary-action" disabled={disabled} onClick={onComplete}>完成本项</button>
        </footer>
      </section>
    </div>
  );
}
