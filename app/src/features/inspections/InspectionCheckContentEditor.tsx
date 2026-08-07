import { useEffect, useId, useRef, useState } from "react";
import { DependenciesContext } from "../../app/dependenciesContext";
import { useContext } from "react";
import {
  formatInspectionCheckSummary,
  INSPECTION_CHECK_DEFINITIONS,
} from "../../domain/inspectionCheckContents";
import type {
  InspectionCheckCategory,
  InspectionCheckSelection,
  InspectionCheckTemplateDefinition,
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
  itemId?: string;
  disabled: boolean;
  onSave(selections: InspectionCheckSelection[]): Promise<void>;
}

function createDraft(selections: readonly InspectionCheckSelection[], definitions: readonly InspectionCheckTemplateDefinition[] = INSPECTION_CHECK_DEFINITIONS): DraftSelections {
  const byCategory = new Map(selections.map((selection) => [selection.category, selection]));
  return Object.fromEntries(definitions.map((definition) => {
    const selection = byCategory.get(definition.category);
    return [definition.category, {
      value: selection ? selection.isCustom ? CUSTOM_VALUE : selection.value : "",
      customValue: selection?.isCustom ? selection.value : "",
    }];
  })) as DraftSelections;
}

function selectionsForDraft(draft: DraftSelections, definitions: readonly InspectionCheckTemplateDefinition[] = INSPECTION_CHECK_DEFINITIONS): InspectionCheckSelection[] {
  const selections: InspectionCheckSelection[] = [];
  for (const definition of definitions) {
    const selection = draft[definition.category];
    if (!selection.value) continue;
    if (selection.value === CUSTOM_VALUE) {
      selections.push({
        category: definition.category,
        ...(INSPECTION_CHECK_DEFINITIONS.some((item) => item.category === definition.category) ? {} : { categoryLabel: definition.label }),
        value: selection.customValue.trim(),
        isCustom: true,
      });
      continue;
    }
    const builtIn = INSPECTION_CHECK_DEFINITIONS.find((item) => item.category === definition.category);
    selections.push({ category: definition.category, ...(builtIn ? {} : { categoryLabel: definition.label }), value: selection.value, isCustom: !(builtIn?.options.some((option) => option === selection.value) ?? false) });
  }
  return selections;
}

export function InspectionCheckContentEditor({
  entry,
  itemId,
  disabled,
  onSave,
}: InspectionCheckContentEditorProps) {
  const dependencies = useContext(DependenciesContext);
  const inspectionCheckTemplateRepository = dependencies?.inspectionCheckTemplateRepository;
  const [definitions, setDefinitions] = useState<readonly InspectionCheckTemplateDefinition[]>(INSPECTION_CHECK_DEFINITIONS);
  const [templateReady, setTemplateReady] = useState(!inspectionCheckTemplateRepository);
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
    ? "????????????"
    : `?????${formatInspectionCheckSummary(displayedSelections, "?", undefined, definitions)}`;

  useEffect(() => {
    setDisplayedSelections(entry.checkSelections);
  }, [entry]);

  useEffect(() => {
    let active = true;
    if (!inspectionCheckTemplateRepository) return;
    inspectionCheckTemplateRepository.get().then((template) => {
      if (!active) return;
      const selected = template.itemOverrides[itemId ?? entry.itemId] ?? template.definitions;
      setDefinitions(selected);
      setDraft(createDraft(entry.checkSelections, selected));
      setTemplateReady(true);
    });
    return () => { active = false; };
  }, [entry.checkSelections, entry.itemId, itemId, inspectionCheckTemplateRepository]);

  useEffect(() => {
    if (!focusCategory || controlsDisabled) return;
    const selection = draft[focusCategory];
    const target = selection.value === CUSTOM_VALUE
      ? customRefs.current[focusCategory]
      : selectRefs.current[focusCategory];
    target?.focus();
    setFocusCategory(null);
  }, [controlsDisabled, draft, focusCategory]);

  async function openEditor() {
    if (controlsDisabled) return;
    if (!templateReady && inspectionCheckTemplateRepository) {
      const template = await inspectionCheckTemplateRepository.get();
      const selected = template.itemOverrides[itemId ?? entry.itemId] ?? template.definitions;
      setDefinitions(selected);
      setDraft(createDraft(displayedSelections, selected));
      setTemplateReady(true);
    } else {
      setDraft(createDraft(displayedSelections, definitions));
    }
    setError("");
    setExpanded(true);
  }

  function cancelEditor() {
    if (controlsDisabled) return;
    setDraft(createDraft(displayedSelections, definitions));
    setError("");
    setExpanded(false);
  }

  function toggleEditor() {
    if (expanded) {
      cancelEditor();
      return;
    }
    void openEditor();
  }

  async function confirmEditor() {
    if (controlsDisabled) return;
    const selections = selectionsForDraft(draft, definitions);
    const invalidCustom = selections.find((selection) => selection.isCustom && !selection.value);
    if (invalidCustom) {
      setError("???????????");
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
      setError(reason instanceof Error ? reason.message : "?????????");
      setFocusCategory(definitions[0]?.category ?? null);
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
          {definitions.map((definition) => {
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
                  onFocus={() => {
                    if (!selection.value && definition.defaultValue) {
                      setDraft((current) => ({
                        ...current,
                        [definition.category]: {
                          ...current[definition.category],
                          value: definition.defaultValue ?? "",
                        },
                      }));
                    }
                  }}
                >
                  <option value="">???</option>
                  {definition.options.map((option) => <option value={option} key={option}>{option}</option>)}
                  <option value={CUSTOM_VALUE}>???</option>
                </select>
                {selection.value === CUSTOM_VALUE ? (
                  <input
                    ref={(element) => { customRefs.current[definition.category] = element ?? undefined; }}
                    className="inspection-check-editor__custom"
                    aria-label={`${definition.label}?????`}
                    placeholder={`????${definition.label}?????`}
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
            <button type="button" disabled={controlsDisabled} onClick={() => void confirmEditor()}>??</button>
            <button type="button" disabled={controlsDisabled} onClick={cancelEditor}>??</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
