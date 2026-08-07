import { useEffect, useState } from "react";
import { useAppDependencies } from "../../app/useAppDependencies";
import type { ChecklistItem, InspectionCheckTemplate, InspectionCheckTemplateDefinition } from "../../domain/models";

function newDefinition(index: number): InspectionCheckTemplateDefinition {
  return { category: `custom-${Date.now()}-${index}`, label: "新大项", options: ["新小项"], defaultValue: "新小项" };
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

  if (!template) return <p className="status-message">正在读取检查内容模板…</p>;
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
      setMessage("至少保留一个有效大项");
      return;
    }
    const next: InspectionCheckTemplate = selectedItem
      ? { ...currentTemplate, itemOverrides: { ...currentTemplate.itemOverrides, [selectedItem]: definitions }, updatedAt: now().toISOString() }
      : { ...currentTemplate, definitions, updatedAt: now().toISOString() };
    await inspectionCheckTemplateRepository.save(next);
    setTemplate(next);
    setMessage("检查内容模板已保存");
  }

  function resetOverride() {
    if (!selectedItem) return;
    const nextOverrides = { ...currentTemplate.itemOverrides };
    delete nextOverrides[selectedItem];
    setTemplate({ ...currentTemplate, itemOverrides: nextOverrides });
    setMessage("已恢复全局默认模板，请保存后生效");
  }

  return <section className="page-section check-template-page">
    <div className="section-heading"><p className="eyebrow">现场检查</p><h2>检查内容模板</h2></div>
    <div className="check-template-toolbar">
      <label>应用范围<select aria-label="模板应用范围" value={selectedItem} onChange={(event) => { setSelectedItem(event.currentTarget.value); setMessage(""); }}><option value="">全局默认模板</option>{items.map((item) => <option key={item.id} value={item.id}>{item.routeName}</option>)}</select></label>
      <p>大项和小项都可以自定义；进入具体检查项点时，会按模板自动预选默认小项。</p>
    </div>
    <div className="check-template-list" data-testid="check-template-list">
      {editing.map((definition, index) => <article className="check-template-card" key={definition.category}>
        <div className="check-template-card__header"><span className="check-template-card__index">{index + 1}</span><strong>检查大项</strong><button type="button" className="text-action danger" disabled={editing.length <= 1} onClick={() => removeDefinition(index)}>删除大项</button></div>
        <label>大项名称<input aria-label={`大项名称 ${index + 1}`} value={definition.label} onChange={(event) => updateDefinition(index, { label: event.currentTarget.value })} /></label>
        <div className="check-template-options"><div className="check-template-options__title"><strong>对应小项</strong><button type="button" className="text-action" onClick={() => updateDefinition(index, { options: [...definition.options, "新小项"] })}>+ 新增小项</button></div>
          {definition.options.map((option, optionIndex) => <div className="check-template-option" key={`${definition.category}-${optionIndex}`}><input aria-label={`小项 ${index + 1}-${optionIndex + 1}`} value={option} onChange={(event) => updateOption(index, optionIndex, event.currentTarget.value)} /><button type="button" className="icon-action" aria-label={`删除小项 ${index + 1}-${optionIndex + 1}`} disabled={definition.options.length <= 1} onClick={() => removeOption(index, optionIndex)}>×</button></div>)}
        </div>
        <label>进入检查时默认小项<select aria-label={`默认小项 ${index + 1}`} value={definition.defaultValue ?? ""} onChange={(event) => updateDefinition(index, { defaultValue: event.currentTarget.value || undefined })}><option value="">不预选</option>{definition.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      </article>)}
    </div>
    <div className="check-template-actions"><button type="button" className="secondary-action" onClick={() => updateEditing([...editing, newDefinition(editing.length)])}>+ 新增大项</button>{selectedItem ? <button type="button" className="secondary-action" onClick={resetOverride}>恢复全局默认</button> : null}<button type="button" className="primary-action" onClick={() => void save()}>保存模板</button></div>
    {message ? <p role="status" className="status-message">{message}</p> : null}
  </section>;
}
