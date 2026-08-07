import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { formatInspectionEvaluationDescription } from "../../domain/inspectionCheckContents";
import type {
  ChecklistItem,
  InspectionCheckSelection,
  InspectionEntry,
  PhotoAsset,
  PhotoCategory,
  PhotoGroup,
} from "../../domain/models";
import { PHOTO_CATEGORIES } from "../../domain/photoCategory";
import { PhotoCaptureButtons, type PhotoInputSource } from "../photos/PhotoCaptureButtons";
import { PhotoGroupEditor } from "../photos/PhotoGroupEditor";
import { InspectionCheckContentEditor } from "./InspectionCheckContentEditor";

export interface InspectionEntryEditorProps {
  entry: InspectionEntry;
  groups: PhotoGroup[];
  photos: PhotoAsset[];
  checklistItem: ChecklistItem;
  disabled: boolean;
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

function EmptyEvaluationPicker({
  disabled,
  onCreatePhotoGroup,
}: {
  disabled: boolean;
  onCreatePhotoGroup(category: PhotoCategory): Promise<void>;
}) {
  const radioName = useId();
  const [pendingCategory, setPendingCategory] = useState<PhotoCategory | null>(null);

  async function chooseCategory(category: PhotoCategory) {
    setPendingCategory(category);
    try {
      await onCreatePhotoGroup(category);
    } catch {
      setPendingCategory(null);
    }
  }

  return (
    <div className="empty-evaluation-picker" role="radiogroup" aria-label="无照片评价分类">
      <span className="empty-evaluation-picker__label">选择评价</span>
      <div className="category-segments">
        {PHOTO_CATEGORIES.map(({ id, label }) => (
          <label key={id} data-category={id}>
            <input
              type="radio"
              name={radioName}
              value={id}
              checked={pendingCategory === id}
              disabled={disabled || pendingCategory !== null}
              onChange={() => void chooseCategory(id)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function PhotoThumbnail({ photo }: { photo: PhotoAsset }) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    try {
      const objectUrl = URL.createObjectURL(photo.thumbnailBlob);
      setSource(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } catch {
      setSource(null);
    }
  }, [photo.thumbnailBlob]);

  return source ? <img src={source} alt="巡检照片缩略图" /> : null;
}

interface PhotoActionsProps {
  photo: PhotoAsset;
  index: number;
  disabled: boolean;
  onDelete(): void;
  onReplace(file: File, source: PhotoInputSource): void;
  onRetake(file: File, source: PhotoInputSource): void;
  onHighQualityChange(highQuality: boolean): void;
}

function PhotoActions({
  photo,
  index,
  disabled,
  onDelete,
  onReplace,
  onRetake,
  onHighQualityChange,
}: PhotoActionsProps) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const retakeInput = useRef<HTMLInputElement>(null);
  const chooseOne = (callback: (file: File) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) callback(file);
  };

  return (
    <div className="photo-item__actions">
      <label>
        <input
          type="checkbox"
          checked={photo.highQuality}
          disabled={disabled}
          onChange={(event) => onHighQualityChange(event.currentTarget.checked)}
        />
        高清保留
      </label>
      <button type="button" disabled={disabled} onClick={() => replaceInput.current?.click()}>
        替换
      </button>
      <input
        ref={replaceInput}
        className="sr-only"
        type="file"
        accept="image/*"
        aria-label={`替换照片 ${index + 1}`}
        onChange={chooseOne((file) => onReplace(file, "gallery"))}
      />
      <button type="button" disabled={disabled} onClick={() => retakeInput.current?.click()}>
        重拍
      </button>
      <input
        ref={retakeInput}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={`重拍照片 ${index + 1}`}
        onChange={chooseOne((file) => onRetake(file, "camera"))}
      />
      <button type="button" disabled={disabled} aria-label={`删除照片 ${index + 1}`} onClick={onDelete}>
        <Trash2 aria-hidden="true" size={17} />
      </button>
    </div>
  );
}

export function InspectionEntryEditor({
  entry,
  groups,
  photos,
  checklistItem,
  disabled,
  onFilesSelected,
  onSaveCheckSelections,
  onCreatePhotoGroup,
  onSavePhotoGroup,
  onSplit,
  onPhotoSave,
  onDeletePhoto,
  onReplacePhoto,
  onHighQualityChange,
}: InspectionEntryEditorProps) {
  const photoCount = groups.reduce((count, group) => count + group.photoIds.length, 0);
  const evaluationDescription = formatInspectionEvaluationDescription(
    entry.itemSnapshot.routeName,
    entry.checkSelections ?? [],
  );
  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  const entryPhotos = photos.filter((photo) => groups.some((group) => group.id === photo.groupId));

  async function saveCheckSelections(selections: InspectionCheckSelection[]) {
    await onSaveCheckSelections(selections);
  }

  return (
    <li
      className="inspection-entry"
      data-inspection-entry-id={entry.id}
      data-checklist-item-id={entry.itemId}
      data-photo-count={photoCount}
      aria-labelledby={`entry-part-${entry.id}`}
    >
      <div className="inspection-entry__main">
        <strong id={`entry-part-${entry.id}`}>{entry.itemSnapshot.part}</strong>
        <span>{[entry.itemSnapshot.area, entry.itemSnapshot.device].filter(Boolean).join(" · ")}</span>
        <InspectionCheckContentEditor
          entry={entry}
          disabled={disabled}
          onSave={saveCheckSelections}
        />
      </div>
      <div className="inspection-entry__counts" aria-label={`照片${photoCount}张`}>
        <span>照片 {photoCount}</span>
        {PHOTO_CATEGORIES.map(({ id, label }) => (
          <span key={id} data-category={id}>
            {label} {groups
              .filter((group) => group.category === id)
              .reduce((count, group) => count + group.photoIds.length, 0)}
          </span>
        ))}
      </div>
      {groups.length === 0 ? (
        <EmptyEvaluationPicker
          disabled={disabled}
          onCreatePhotoGroup={onCreatePhotoGroup}
        />
      ) : null}
      <PhotoCaptureButtons disabled={disabled} onFilesSelected={onFilesSelected} />
      {!disabled && groups.map((group) => {
        const groupPhotos = group.photoIds
          .map((photoId) => photosById.get(photoId))
          .filter((photo): photo is PhotoAsset => Boolean(photo));
        return (
          <PhotoGroupEditor
            key={group.id}
            item={checklistItem}
            group={group}
            photos={groupPhotos}
            descriptionOverride={evaluationDescription || undefined}
            onSave={onSavePhotoGroup}
            onSplit={(photoId, category) => onSplit(group, photoId, category)}
            onPhotoSave={onPhotoSave}
          />
        );
      })}
      {groups.length > 0 ? (
        <ul className="photo-thumbnail-list">
          {entryPhotos.map((photo, index) => (
            <li className="photo-item" key={photo.id}>
              <PhotoThumbnail photo={photo} />
              <PhotoActions
                photo={photo}
                index={index}
                disabled={disabled}
                onDelete={() => onDeletePhoto(photo.id)}
                onReplace={(file, source) => onReplacePhoto(photo, file, source)}
                onRetake={(file, source) => onReplacePhoto(photo, file, source)}
                onHighQualityChange={(value) => onHighQualityChange(photo, value)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
