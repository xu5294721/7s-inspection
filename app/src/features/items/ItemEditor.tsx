import { useState } from "react";
import { defaultGeneralText } from "../../domain/inspection";
import type { ChecklistItem, SevenSCategory } from "../../domain/models";

const categories: SevenSCategory[] = ["", "整理", "整顿", "清扫", "清洁", "素养", "安全", "节约"];

interface ItemEditorProps {
  item: ChecklistItem;
  onCancel(): void;
  onSave(item: ChecklistItem): Promise<void>;
}

export function ItemEditor({ item, onCancel, onSave }: ItemEditorProps) {
  const [draft, setDraft] = useState<ChecklistItem>({
    ...item,
    generalText: item.generalText?.trim() || defaultGeneralText(item),
    quickPhrases: [...item.quickPhrases],
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ChecklistItem>(key: K, value: ChecklistItem[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function save() {
    const required: Array<keyof ChecklistItem> = ["routeName", "area", "part", "standard", "team", "goodText", "generalText", "reminderText", "assessmentText"];
    if (required.some((key) => !String(draft[key]).trim()) || !Number.isSafeInteger(draft.routeOrder) || draft.routeOrder < 1) {
      setError("请完整填写必填项，路线顺序须为正整数。");
      return;
    }
    setSaving(true);
    try { await onSave({ ...draft, updatedAt: new Date().toISOString() }); }
    catch { setError("保存项点失败，请重试。"); setSaving(false); }
  }
  return <section className="page-section item-editor-page">
    <div className="section-heading"><p className="eyebrow">项点库编辑</p><h2>编辑检查项点</h2></div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    <div className="form-grid">
      <label>路线顺序<input aria-label="路线顺序" type="number" min="1" value={draft.routeOrder} onChange={(event) => set("routeOrder", Number(event.currentTarget.value))} /></label>
      <label>路线名称<input aria-label="路线名称" value={draft.routeName} onChange={(event) => set("routeName", event.currentTarget.value)} /></label>
      <label>区域<input aria-label="区域" value={draft.area} onChange={(event) => set("area", event.currentTarget.value)} /></label>
      <label>设备岗位<input aria-label="设备岗位" value={draft.device} onChange={(event) => set("device", event.currentTarget.value)} /></label>
      <label>检查部位<input aria-label="检查部位" value={draft.part} onChange={(event) => set("part", event.currentTarget.value)} /></label>
      <label>检查标准<textarea aria-label="检查标准" value={draft.standard} onChange={(event) => set("standard", event.currentTarget.value)} /></label>
      <label>责任工班<input aria-label="责任工班" value={draft.team} onChange={(event) => set("team", event.currentTarget.value)} /></label>
      <label>7S类别<select aria-label="7S类别" value={draft.sevenSCategory} onChange={(event) => set("sevenSCategory", event.currentTarget.value as SevenSCategory)}>{categories.map((category) => <option key={category} value={category}>{category || "未分类"}</option>)}</select></label>
      <label>好的表述<textarea aria-label="好的表述" value={draft.goodText} onChange={(event) => set("goodText", event.currentTarget.value)} /></label>
      <label>一般表现表述<textarea aria-label="一般表现表述" value={draft.generalText ?? ""} onChange={(event) => set("generalText", event.currentTarget.value)} /></label>
      <label>提醒表述<textarea aria-label="提醒表述" value={draft.reminderText} onChange={(event) => set("reminderText", event.currentTarget.value)} /></label>
      <label>考核表述<textarea aria-label="考核表述" value={draft.assessmentText} onChange={(event) => set("assessmentText", event.currentTarget.value)} /></label>
      <label>常用短语（以 | 分隔）<textarea aria-label="常用短语" value={draft.quickPhrases.join(" | ")} onChange={(event) => set("quickPhrases", event.currentTarget.value.split("|").map((value) => value.trim()).filter(Boolean))} /></label>
    </div>
    <div className="page-actions"><button type="button" className="secondary-action" onClick={onCancel}>取消</button><button type="button" className="primary-action" disabled={saving} onClick={() => void save()}>{saving ? "正在保存" : "保存项点"}</button></div>
  </section>;
}
