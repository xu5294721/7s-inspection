import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  onCancelInspection(): Promise<void>;
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
  onCancelInspection,
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
  const cancelActionRef = useRef<HTMLButtonElement | null>(null);
  const cancelDialogRef = useRef<HTMLElement | null>(null);
  const cancelDialogCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onCancelInspectionRef = useRef(onCancelInspection);
  const disabledRef = useRef(disabled);
  const cancelDialogOpenRef = useRef(false);
  const isCancellingRef = useRef(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  onCloseRef.current = onClose;
  onCancelInspectionRef.current = onCancelInspection;
  disabledRef.current = disabled;
  cancelDialogOpenRef.current = cancelDialogOpen;
  isCancellingRef.current = isCancelling;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const sheet = dialog;

    function handleKeyDown(event: KeyboardEvent) {
      if (cancelDialogOpenRef.current) return;
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

  useEffect(() => {
    if (!cancelDialogOpen) return;
    cancelDialogCancelButtonRef.current?.focus();
    const cancelAction = cancelActionRef.current;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isCancellingRef.current) {
        event.preventDefault();
        setCancelDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = cancelDialogRef.current;
      if (!dialog) return;
      const focusable = focusableElements(dialog);
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
      if (cancelAction && document.contains(cancelAction)) {
        cancelAction.focus();
      }
    };
  }, [cancelDialogOpen]);

  async function confirmCancelInspection() {
    if (disabled || isCancelling) return;
    setIsCancelling(true);
    try {
      await onCancelInspectionRef.current();
      setCancelDialogOpen(false);
    } catch {
      // The page owns the shared error message; keep this confirmation open for retry.
    } finally {
      setIsCancelling(false);
    }
  }

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
          <div className="inspection-item-sheet__footer-actions">
            <button type="button" className="secondary-action" disabled={disabled} onClick={onClose}>暂存并关闭</button>
            <button type="button" className="primary-action" disabled={disabled} onClick={onComplete}>完成本项</button>
          </div>
          <button
            ref={cancelActionRef}
            type="button"
            className="danger-action inspection-item-sheet__cancel-action"
            disabled={disabled}
            onClick={() => setCancelDialogOpen(true)}
          >
            取消本项检查
          </button>
        </footer>
      </section>
      {cancelDialogOpen ? (
        <div className="confirmation-backdrop" role="presentation">
          <section
            ref={cancelDialogRef}
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-inspection-entry-title"
            aria-busy={isCancelling}
            tabIndex={-1}
          >
            <h3 id="cancel-inspection-entry-title">确认取消本项检查</h3>
            <p>照片、评价和检查内容将被清除，项点本身仍保留并恢复为未完成。</p>
            <div>
              <button
                ref={cancelDialogCancelButtonRef}
                type="button"
                disabled={isCancelling}
                onClick={() => setCancelDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-action"
                disabled={isCancelling}
                onClick={() => void confirmCancelInspection()}
              >
                {isCancelling ? "正在取消" : "确认取消"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
