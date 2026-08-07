import { useEffect, useState } from "react";
import { useAppDependencies } from "../../app/useAppDependencies";
import type { ChecklistItem, InspectionCheckTemplate, InspectionCheckTemplateDefinition } from "../../domain/models";

function newDefinition(index: number): InspectionCheckTemplateDefinition {
  return { category: `custom-${Date.now()}-${index}`, label: "???", options: ["???"], defaultValue: "???" };
}

export function InspectionCheckTemplatePage() {
  const { inspectionCheckTemplateRepository, itemRepository, now } = useAppDependencies();
  const [template, setTemplate] = useState<InspectionCheckTemplate>();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [selectedItem, setSelectedItem] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([inspectionCheckTemplateRepository.get(), itemRepository.listAll()]).then(([value, allItems]) => {
      setTemplate(value);
      setItems(allItems);
    });
  }, [inspectionCheckTemplateRepository, itemRepository]);

  if (!template) return <p className="status-message">???????????</p>;
  const currentTemplate = template;
  const editing = selectedItem
    ? currentTemplate.itemOverrides[selectedItem] ?? currentTemplate.definitions
    : currentTemplate.definitions;

  function updateEditing(next: readonly InspectionCheckTemplateDefinition[]) {
    if (!selectedItem) setTemplate({ ...currentTemplate, definitions: [...next] });
    else setTemplate({ ...currentTemplate, itemOverrides: { ...currentTemplate.itemOverrides, [selectedItem]: [...next] } });
    setMessage("");
  }

  function updateDefinition(index: number, patch: Partial<InspectionCheckTemplateDefinition>) {
    updateEditing(editing.map((definition, currentIndex) => currentIndex === index ? { ...definition, ...patch } : definition));
  }

  function updateOption(index: number, optionIndex: number, value: string) {
    const definition = editing[index];
    if (!definition) return;
    const options = definition.options.map((option, currentIndex) => currentIndex === optionIndex ? value : option);
    updateDefinition(index, { options, defaultValue: definition.defaultValue === definition.options[optionIndex] ? value : definition.defaultValue });
  }

  function removeDefinition(index: number) {
    if (editing.length <= 1) return;
    updateEditing(editing.filter((_, currentIndex) => currentIndex !== index));
  }

  function removeOption(index: number, optionIndex: number) {
    const definition = editing[index];
    if (!definition || definition.options.length <= 1) return;
    const options = definition.options.filter((_, currentIndex) => currentIndex !== optionIndex);
    updateDefinition(index, { options, defaultValue: options.includes(definition.defaultValue ?? "") ? definition.defaultValue : options[0] });
  }

  async function save() {
    const definitions = editing
      .map((definition) => ({
        ...definition,
        label: definition.label.trim(),
        options: definition.options.map((option) => option.trim()).filter(Boolean),
        defaultValue: definition.defaultValue?.trim(),
      }))
      .filter((definition) => definition.label && definition.options.length)
      .map((definition) => ({ ...definition, defaultValue: definition.options.includes(definition.defaultValue ?? "") ? definition.defaultValue : undefined }));
    if (!definitions.length) {
      setMessage("??????????");
      return;
    }
    const next: InspectionCheckTemplate = selectedItem
      ? { ...currentTemplate, itemOverrides: { ...currentTemplate.itemOverrides, [selectedItem]: definitions }, updatedAt: now().toISOString() }
      : { ...currentTemplate, definitions, updatedAt: now().toISOString() };
    await inspectionCheckTemplateRepository.save(next);
    setTemplate(next);
    setMessage("?????????");
  }

  function resetOverride() {
    if (!selectedItem) return;
    const nextOverrides = { ...currentTemplate.itemOverrides };
    delete nextOverrides[selectedItem];
    setTemplate({ ...currentTemplate, itemOverrides: nextOverrides });
    setMessage("????????????????");
  }

  return <section className="page-section check-template-page">
    <div className="section-heading"><p className="eyebrow">????</p><h2>??????</h2></div>
    <div className="check-template-toolbar">
      <label>????<select aria-label="??????" value={selectedItem} onChange={(event) => { setSelectedItem(event.currentTarget.value); setMessage(""); }}><option value="">??????</option>{items.map((item) => <option key={item.id} value={item.id}>{item.routeName}</option>)}</select></label>
      <p>???????????????????????????????????</p>
    </div>
    <div className="check-template-list" data-testid="check-template-list">
      {editing.map((definition, index) => <article className="check-template-card" key={definition.category}>
        <div className="check-template-card__header"><span className="check-template-card__index">{index + 1}</span><strong>????</strong><button type="button" className="text-action danger" disabled={editing.length <= 1} onClick={() => removeDefinition(index)}>????</button></div>
        <label>????<input aria-label={`???? ${index + 1}`} value={definition.label} onChange={(event) => updateDefinition(index, { label: event.currentTarget.value })} /></label>
        <div className="check-template-options"><div className="check-template-options__title"><strong>????</strong><button type="button" className="text-action" onClick={() => updateDefinition(index, { options: [...definition.options, "???"] })}>+ ????</button></div>
          {definition.options.map((option, optionIndex) => <div className="check-template-option" key={`${definition.category}-${optionIndex}`}><input aria-label={`?? ${index + 1}-${optionIndex + 1}`} value={option} onChange={(event) => updateOption(index, optionIndex, event.currentTarget.value)} /><button type="button" className="icon-action" aria-label={`???? ${index + 1}-${optionIndex + 1}`} disabled={definition.options.length <= 1} onClick={() => removeOption(index, optionIndex)}>?</button></div>)}
        </div>
        <label>?????????<select aria-label={`???? ${index + 1}`} value={definition.defaultValue ?? ""} onChange={(event) => updateDefinition(index, { defaultValue: event.currentTarget.value || undefined })}><option value="">???</option>{definition.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      </article>)}
    </div>
    <div className="check-template-actions"><button type="button" className="secondary-action" onClick={() => updateEditing([...editing, newDefinition(editing.length)])}>+ ????</button>{selectedItem ? <button type="button" className="secondary-action" onClick={resetOverride}>??????</button> : null}<button type="button" className="primary-action" onClick={() => void save()}>????</button></div>
    {message ? <p role="status" className="status-message">{message}</p> : null}
  </section>;
}
