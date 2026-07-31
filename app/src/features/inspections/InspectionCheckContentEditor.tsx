import { useEffect, useId, useRef, useState } from "react";
import {
  formatInspectionCheckSummary,
  INSPECTION_CHECK_DEFINITIONS,
} from "../../domain/inspectionCheckContents";
import type {
  InspectionCheckCategory,
  InspectionCheckSelection,
  InspectionEntry,
} from "../../domain/models";

const CUSTOM_VALUE = "__custom__";

interface DraftSelection {
  value: string;
  customValue: string;
}

type DraftSelections = Record<InspectionCheckCategory, DraftSelection>;

export interface InspectionCheckContentEditorProps {
  entry: InspectionEntry;
  disabled: boolean;
  onSave(selections: InspectionCheckSelection[]): Promise<void>;
}

function createDraft(selections: readonly InspectionCheckSelection[]): DraftSelections {
  const byCategory = new Map(selections.map((selection) => [selection.category, selection]));
  return Object.fromEntries(INSPECTION_CHECK_DEFINITIONS.map((definition) => {
    const selection = byCategory.get(definition.category);
    return [definition.category, {
      value: selection ? selection.isCustom ? CUSTOM_VALUE : selection.value : "",
      customValue: selection?.isCustom ? selection.value : "",
    }];
  })) as DraftSelections;
}

function selectionsForDraft(draft: DraftSelections): InspectionCheckSelection[] {
  const selections: InspectionCheckSelection[] = [];
  for (const definition of INSPECTION_CHECK_DEFINITIONS) {
    const selection = draft[definition.category];
    if (!selection.value) continue;
    if (selection.value === CUSTOM_VALUE) {
      selections.push({
        category: definition.category,
        value: selection.customValue.trim(),
        isCustom: true,
      });
      continue;
    }
    selections.push({ category: definition.category, value: selection.value, isCustom: false });
  }
  return selections;
}

export function InspectionCheckContentEditor({
  entry,
  disabled,
  onSave,
}: InspectionCheckContentEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(() => createDraft(entry.checkSelections));
  const [displayedSelections, setDisplayedSelections] = useState(entry.checkSelections);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [focusCategory, setFocusCategory] = useState<InspectionCheckCategory | null>(null);
  const editorId = useId();
  const selectRefs = useRef<Partial<Record<InspectionCheckCategory, HTMLSelectElement>>>({});
  const customRefs = useRef<Partial<Record<InspectionCheckCategory, HTMLInputElement>>>({});
  const controlsDisabled = disabled || saving;
  const summary = displayedSelections.length === 0
    ? "检查内容：请选择检查内容"
    : `检查内容：${formatInspectionCheckSummary(displayedSelections)}`;

  useEffect(() => {
    setDisplayedSelections(entry.checkSelections);
  }, [entry]);

  useEffect(() => {
    if (!focusCategory || controlsDisabled) return;
    const selection = draft[focusCategory];
    const target = selection.value === CUSTOM_VALUE
      ? customRefs.current[focusCategory]
      : selectRefs.current[focusCategory];
    target?.focus();
    setFocusCategory(null);
  }, [controlsDisabled, draft, focusCategory]);

  function openEditor() {
    if (controlsDisabled) return;
    setDraft(createDraft(displayedSelections));
    setError("");
    setExpanded(true);
  }

  function cancelEditor() {
    if (controlsDisabled) return;
    setDraft(createDraft(displayedSelections));
    setError("");
    setExpanded(false);
  }

  function toggleEditor() {
    if (expanded) {
      cancelEditor();
      return;
    }
    openEditor();
  }

  async function confirmEditor() {
    if (controlsDisabled) return;
    const selections = selectionsForDraft(draft);
    const invalidCustom = selections.find((selection) => selection.isCustom && !selection.value);
    if (invalidCustom) {
      setError("请输入自定义检查内容。");
      setFocusCategory(invalidCustom.category);
      return;
    }

    setError("");
    setSaving(true);
    try {
      await onSave(selections);
      setDisplayedSelections(selections);
      setExpanded(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "检查内容保存失败。");
      setFocusCategory(INSPECTION_CHECK_DEFINITIONS[0].category);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inspection-check-editor">
      <button
        type="button"
        className="inspection-check-editor__summary"
        disabled={controlsDisabled}
        aria-expanded={expanded}
        onClick={toggleEditor}
      >
        {summary}
      </button>
      {expanded ? (
        <div className="inspection-check-editor__panel" aria-busy={saving}>
          {INSPECTION_CHECK_DEFINITIONS.map((definition) => {
            const selection = draft[definition.category];
            const selectId = `${editorId}-${definition.category}`;
            return (
              <div className="inspection-check-editor__row" key={definition.category}>
                <label htmlFor={selectId}>{definition.label}</label>
                <select
                  id={selectId}
                  ref={(element) => { selectRefs.current[definition.category] = element ?? undefined; }}
                  disabled={controlsDisabled}
                  value={selection.value}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setError("");
                    setDraft((current) => ({
                      ...current,
                      [definition.category]: {
                        value,
                        customValue: current[definition.category].customValue,
                      },
                    }));
                  }}
                >
                  <option value="">未选择</option>
                  {definition.options.map((option) => <option value={option} key={option}>{option}</option>)}
                  <option value={CUSTOM_VALUE}>自定义</option>
                </select>
                {selection.value === CUSTOM_VALUE ? (
                  <input
                    ref={(element) => { customRefs.current[definition.category] = element ?? undefined; }}
                    className="inspection-check-editor__custom"
                    aria-label={`${definition.label}自定义内容`}
                    placeholder={`仅输入“${definition.label}”后的描述`}
                    disabled={controlsDisabled}
                    value={selection.customValue}
                    onChange={(event) => {
                      const customValue = event.currentTarget.value;
                      setError("");
                      setDraft((current) => ({
                        ...current,
                        [definition.category]: {
                          ...current[definition.category],
                          customValue,
                        },
                      }));
                    }}
                  />
                ) : null}
              </div>
            );
          })}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          <div className="inspection-check-editor__actions">
            <button type="button" disabled={controlsDisabled} onClick={() => void confirmEditor()}>确认</button>
            <button type="button" disabled={controlsDisabled} onClick={cancelEditor}>取消</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
