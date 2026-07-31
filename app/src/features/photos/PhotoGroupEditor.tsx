import { Check, Pencil, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  descriptionForCategory,
  isPositiveSafeInteger,
} from "../../domain/inspection";
import type {
  ChecklistItem,
  PhotoAsset,
  PhotoCategory,
  PhotoGroup,
} from "../../domain/models";
import { PhotoAnnotationDialog } from "./PhotoAnnotationDialog";

export interface PhotoGroupEditorProps {
  item: ChecklistItem;
  group: PhotoGroup;
  photos: PhotoAsset[];
  descriptionOverride?: string;
  onSave: (group: PhotoGroup) => Promise<void>;
  onSplit: (photoId: string, category: PhotoCategory) => Promise<void>;
  onPhotoSave?: (photo: PhotoAsset) => Promise<void>;
}

const categoryOptions: Array<{ value: PhotoCategory; label: string }> = [
  { value: "good", label: "好的方面" },
  { value: "reminder", label: "提醒问题" },
  { value: "assessment", label: "考核问题" },
];

function parseAmount(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const amount = Number(value);
  return isPositiveSafeInteger(amount) ? amount : null;
}

export function PhotoGroupEditor({
  item,
  group,
  photos,
  descriptionOverride,
  onSave,
  onSplit,
  onPhotoSave,
}: PhotoGroupEditorProps) {
  const radioName = useId();
  const [draft, setDraft] = useState<PhotoGroup>(() => ({ ...group, photoIds: [...group.photoIds] }));
  const [rewardEnabled, setRewardEnabled] = useState(group.awardAssessment?.type === "reward");
  const [people, setPeople] = useState(group.awardAssessment?.people ?? "");
  const [amountInput, setAmountInput] = useState(
    group.awardAssessment && group.awardAssessment.amount > 0
      ? String(group.awardAssessment.amount)
      : "",
  );
  const [amountError, setAmountError] = useState("");
  const [formError, setFormError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [annotationPhoto, setAnnotationPhoto] = useState<PhotoAsset | null>(null);
  const draftRef = useRef(draft);
  const groupRef = useRef(group);
  groupRef.current = group;
  const structureSignature = [
    group.id,
    group.inspectionId,
    group.entryId,
    String(group.order),
    ...group.photoIds,
  ].join("\u0000");
  const previousStructureSignature = useRef(structureSignature);
  const descriptionSource = useRef<"preset" | "edited">(
    group.descriptionManuallyEdited ? "edited" : "preset",
  );
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editVersion = useRef(0);
  const savedVersion = useRef(0);
  const latestRequest = useRef<{ version: number; snapshot: PhotoGroup } | null>(null);
  const queuedVersions = useRef(new Set<number>());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveQueueBusy = useRef(false);
  const mounted = useRef(true);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  function updateDraft(next: PhotoGroup): PhotoGroup {
    draftRef.current = next;
    setDraft(next);
    return next;
  }

  function withCurrentStructure(next: PhotoGroup): PhotoGroup {
    const currentGroup = groupRef.current;
    return {
      ...next,
      id: currentGroup.id,
      inspectionId: currentGroup.inspectionId,
      entryId: currentGroup.entryId,
      photoIds: [...currentGroup.photoIds],
      order: currentGroup.order,
    };
  }

  function markDirty(next: PhotoGroup) {
    const current = withCurrentStructure(next);
    updateDraft(current);
    const request = { version: editVersion.current + 1, snapshot: current };
    editVersion.current = request.version;
    latestRequest.current = request;
    return request;
  }

  function queueSave(request: { version: number; snapshot: PhotoGroup }): Promise<void> {
    if (queuedVersions.current.has(request.version)) return saveQueue.current;
    queuedVersions.current.add(request.version);
    if (mounted.current) setSaveError("");

    const execute = async () => {
      try {
        await onSaveRef.current(withCurrentStructure(request.snapshot));
        savedVersion.current = Math.max(savedVersion.current, request.version);
        if (latestRequest.current?.version === request.version) latestRequest.current = null;
        if (mounted.current) setSaveError("");
      } catch (error) {
        if (mounted.current) {
          setSaveError(error instanceof Error ? error.message : "评价保存失败");
        }
      } finally {
        queuedVersions.current.delete(request.version);
      }
    };

    const operation = saveQueueBusy.current ? saveQueue.current.then(execute) : execute();
    saveQueueBusy.current = true;
    const tail = operation.finally(() => {
      if (saveQueue.current === tail) saveQueueBusy.current = false;
    });
    saveQueue.current = tail;
    return tail;
  }

  function persist(next: PhotoGroup): Promise<void> {
    return queueSave(markDirty(next));
  }

  function flushText(): Promise<void> {
    if (textTimer.current) {
      clearTimeout(textTimer.current);
      textTimer.current = null;
    }
    const request = latestRequest.current;
    if (!request || request.version <= savedVersion.current) return saveQueue.current;
    return queueSave(request);
  }

  function scheduleTextSave() {
    if (textTimer.current) clearTimeout(textTimer.current);
    textTimer.current = setTimeout(() => {
      void flushText();
    }, 300);
  }

  useEffect(() => {
    if (previousStructureSignature.current === structureSignature) return;
    previousStructureSignature.current = structureSignature;
    const request = latestRequest.current;
    if (!request || request.version <= savedVersion.current) return;
    if (textTimer.current) {
      clearTimeout(textTimer.current);
      textTimer.current = null;
    }
    const current = withCurrentStructure(draftRef.current);
    updateDraft(current);
    const retry = { version: editVersion.current + 1, snapshot: current };
    editVersion.current = retry.version;
    latestRequest.current = retry;
    void queueSave(retry);
  }, [structureSignature]);

  useEffect(() => () => {
    mounted.current = false;
    if (textTimer.current) clearTimeout(textTimer.current);
    const request = latestRequest.current;
    if (request && request.version > savedVersion.current) {
      const currentGroup = groupRef.current;
      const retry = {
        version: editVersion.current + 1,
        snapshot: {
          ...draftRef.current,
          id: currentGroup.id,
          inspectionId: currentGroup.inspectionId,
          entryId: currentGroup.entryId,
          photoIds: [...currentGroup.photoIds],
          order: currentGroup.order,
        },
      };
      editVersion.current = retry.version;
      latestRequest.current = retry;
      void queueSave(retry);
    }
  }, []);

  function awardFor(category: PhotoCategory, nextPeople = people, nextAmount = amountInput) {
    if (category === "reminder" || (category === "good" && !rewardEnabled)) return null;
    return {
      type: category === "good" ? "reward" as const : "assessment" as const,
      people: nextPeople.trim(),
      amount: parseAmount(nextAmount) ?? 0,
    };
  }

  function applyCategory(category: PhotoCategory) {
    if (category === draftRef.current.category) return;
    const description = descriptionSource.current === "preset"
      ? descriptionForCategory(item, category)
      : draftRef.current.description;
    setRewardEnabled(false);
    setPeople("");
    setAmountInput("");
    setAmountError("");
    setFormError("");
    void persist({
      ...draftRef.current,
      category,
      description,
      descriptionManuallyEdited: descriptionSource.current === "edited",
      awardAssessment: null,
      photoIds: [...draftRef.current.photoIds],
    });
  }

  function changeDescription(value: string) {
    descriptionSource.current = "edited";
    const next = { ...draftRef.current, description: value, descriptionManuallyEdited: true };
    if (value.trim()) {
      markDirty(next);
      scheduleTextSave();
    } else {
      updateDraft(next);
    }
  }

  function changePeople(value: string) {
    setPeople(value);
    const awardAssessment = awardFor(draftRef.current.category, value);
    const next = { ...draftRef.current, awardAssessment };
    markDirty(next);
    scheduleTextSave();
  }

  function chooseAmount(value: string) {
    setAmountInput(value);
    const amount = parseAmount(value);
    setAmountError(value && amount === null ? "请输入大于0的整数金额" : "");
    const awardAssessment = awardFor(draftRef.current.category, people, value);
    const next = { ...draftRef.current, awardAssessment };
    void persist(next);
  }

  function validateAndFlush() {
    setFormError("");
    const amount = parseAmount(amountInput);
    const needsDetails = draft.category === "assessment" || (draft.category === "good" && rewardEnabled);
    if (!draft.description.trim()) {
      setFormError("评价说明不能为空");
      return;
    }
    if (needsDetails && !people.trim()) {
      setFormError(draft.category === "assessment" ? "请填写考核人员" : "请填写奖励人员");
      return;
    }
    if (needsDetails && amount === null) {
      setAmountError("请输入大于0的整数金额");
      return;
    }
    const next = {
      ...draftRef.current,
      awardAssessment: awardFor(draftRef.current.category),
    };
    markDirty(next);
    void flushText();
  }

  async function adjustPhoto(photoId: string, category: PhotoCategory) {
    setOpenMenu(null);
    if (group.photoIds.length === 1) {
      applyCategory(category);
      return;
    }
    try {
      await onSplit(photoId, category);
    } catch (error) {
      if (mounted.current) {
        setSaveError(error instanceof Error ? error.message : "照片分类调整失败");
      }
    }
  }

  async function saveAnnotation(annotationJson: string | null) {
    if (!annotationPhoto || !onPhotoSave) return;
    await onPhotoSave({ ...annotationPhoto, annotationJson });
    setAnnotationPhoto(null);
  }

  return (
    <section className="photo-group-editor" data-testid={`photo-group-${group.id}`}>
      <div className="category-segments" role="radiogroup" aria-label="照片评价分类">
        {categoryOptions.map((option) => (
          <label key={option.value} data-category={option.value}>
            <input
              type="radio"
              name={radioName}
              value={option.value}
              checked={draft.category === option.value}
              onChange={() => applyCategory(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <label className="group-description">
        <span>评价说明</span>
        <textarea
          aria-label="评价说明"
          value={descriptionSource.current === "preset" && descriptionOverride !== undefined
            ? descriptionOverride
            : draft.description}
          onChange={(event) => changeDescription(event.currentTarget.value)}
        />
      </label>
      {draft.category === "good" ? (
        <div className="award-fields">
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={rewardEnabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                setRewardEnabled(enabled);
                if (enabled) {
                  void persist({
                    ...draftRef.current,
                    awardAssessment: { type: "reward", people: "", amount: 0 },
                  });
                } else {
                  setPeople("");
                  setAmountInput("");
                  void persist({ ...draftRef.current, awardAssessment: null });
                }
              }}
            />
            设置奖励
          </label>
          {rewardEnabled ? (
            <AwardInputs
              kind="reward"
              people={people}
              amount={amountInput}
              onPeopleChange={changePeople}
              onAmountChange={chooseAmount}
            />
          ) : null}
        </div>
      ) : null}
      {draft.category === "assessment" ? (
        <AwardInputs
          kind="assessment"
          people={people}
          amount={amountInput}
          onPeopleChange={changePeople}
          onAmountChange={chooseAmount}
        />
      ) : null}
      {amountError || formError || saveError ? (
        <p className="inline-error" role="alert">{amountError || formError || saveError}</p>
      ) : null}
      <div className="group-photo-tools">
        {photos.map((photo) => (
          <div className="group-photo-tools__item" key={photo.id}>
            <button
              type="button"
              aria-label={`调整照片 ${photo.id}`}
              aria-expanded={openMenu === photo.id}
              onClick={() => setOpenMenu((current) => current === photo.id ? null : photo.id)}
            >
              <SlidersHorizontal aria-hidden="true" size={18} />
            </button>
            {openMenu === photo.id ? (
              <div className="photo-category-menu" role="menu">
                {categoryOptions.map((option) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={option.value}
                    onClick={() => void adjustPhoto(photo.id, option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            {onPhotoSave ? (
              <button type="button" aria-label={`标注照片 ${photo.id}`} onClick={() => setAnnotationPhoto(photo)}>
                <Pencil aria-hidden="true" size={18} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <button className="flush-evaluation" type="button" onClick={validateAndFlush}>
        <Check aria-hidden="true" size={18} />
        保存评价
      </button>
      {annotationPhoto ? (
        <PhotoAnnotationDialog
          photo={annotationPhoto}
          onCancel={() => setAnnotationPhoto(null)}
          onSave={saveAnnotation}
        />
      ) : null}
    </section>
  );
}

function AwardInputs({
  kind,
  people,
  amount,
  onPeopleChange,
  onAmountChange,
}: {
  kind: "reward" | "assessment";
  people: string;
  amount: string;
  onPeopleChange(value: string): void;
  onAmountChange(value: string): void;
}) {
  const label = kind === "reward" ? "奖励" : "考核";
  return (
    <div className="award-inputs">
      <label>
        <span>{label}人员</span>
        <input
          aria-label={`${label}人员`}
          value={people}
          onChange={(event) => onPeopleChange(event.currentTarget.value)}
        />
      </label>
      <div className="amount-presets" aria-label={`${label}金额快捷选择`}>
        {[30, 50, 70].map((preset) => (
          <button type="button" key={preset} onClick={() => onAmountChange(String(preset))}>
            {preset}元
          </button>
        ))}
      </div>
      <label>
        <span>其他金额</span>
        <input
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          aria-label="其他金额"
          value={amount}
          onChange={(event) => onAmountChange(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}
