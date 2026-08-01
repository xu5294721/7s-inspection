import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppDependencies } from "../../app/useAppDependencies";
import type { PhotoLayoutMode, PhotosPerRow, ReportSection, ReportTemplate } from "../../domain/models";
import { PHOTO_ROW_COUNTS } from "../../domain/photoLayout";
import { reportTemplateSchema } from "../../domain/schemas";
import { parseBodyFontSizeInput, parseFirstLineIndentInput } from "./reportTemplateInputs";

function cloneTemplate(template: ReportTemplate): ReportTemplate {
  return { ...template, requirements: [...template.requirements], sections: template.sections.map((section) => ({ ...section })), marginMm: { ...template.marginMm } };
}

export function TemplateSettingsPage() {
  const { inspectionRepository, templateRepository } = useAppDependencies();
  const [draft, setDraft] = useState<ReportTemplate | null>(null);
  const [bodyFontSizeInput, setBodyFontSizeInput] = useState("");
  const [firstLineIndentInput, setFirstLineIndentInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    templateRepository.getLatest("template-default").then((template) => {
      if (!active) return;
      if (template) {
        setDraft(cloneTemplate(template));
        setBodyFontSizeInput(String(template.bodyFontSizePt));
        setFirstLineIndentInput(String(template.firstLineIndentChars));
      }
      else setError("默认模板不存在，请先恢复默认模板后重试。");
    }, () => active && setError("模板加载失败，请重试。"));
    return () => { active = false; };
  }, [templateRepository]);
  const set = <K extends keyof ReportTemplate>(key: K, value: ReportTemplate[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const setMargin = (side: keyof ReportTemplate["marginMm"], value: number) => setDraft((current) => current ? { ...current, marginMm: { ...current.marginMm, [side]: value } } : current);
  const setSection = (index: number, patch: Partial<ReportSection>) => setDraft((current) => current ? { ...current, sections: current.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section) } : current);
  async function save() {
    if (!draft || saving) return;
    const bodyFontSizePt = parseBodyFontSizeInput(bodyFontSizeInput);
    if (bodyFontSizePt === null) { setError("正文字号请输入三号或大于0的磅值"); return; }
    const firstLineIndentChars = parseFirstLineIndentInput(firstLineIndentInput);
    if (firstLineIndentChars === null) { setError("正文首行缩进请输入不小于0的字符数"); return; }
    const candidate = { ...cloneTemplate(draft), bodyFontSizePt, firstLineIndentChars, version: draft.version + 1 };
    const result = reportTemplateSchema.safeParse(candidate);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "模板内容不合法。"); return; }
    setSaving(true);
    try {
      await templateRepository.save(result.data);
      const activeInspections = await inspectionRepository.listGraphs(false);
      await Promise.all(activeInspections
        .filter((graph) =>
          graph.inspection.status !== "generated" &&
          graph.inspection.templateId === result.data.id,
        )
        .map((graph) => inspectionRepository.updateReviewSettings(
          graph.inspection.id,
          result.data.id,
          result.data.version,
          graph.inspection.photoLayoutModeOverride,
          graph.inspection.photosPerRowOverride,
        )));
      setDraft(cloneTemplate(result.data));
      setBodyFontSizeInput(String(result.data.bodyFontSizePt));
      setFirstLineIndentInput(String(result.data.firstLineIndentChars));
      setError("");
    } catch { setError("保存模板版本失败，请重试。"); }
    finally { setSaving(false); }
  }
  if (!draft) return <p className="status-message" role={error ? "alert" : "status"}>{error || "正在加载模板..."}</p>;
  return <section className="page-section template-settings-page">
    <div className="section-heading"><p className="eyebrow">当前编辑 v{draft.version}，保存后将生成 v{draft.version + 1}</p><h2>Word模板设置</h2></div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    <div className="form-grid template-form">
      <label>模板名称<input aria-label="模板名称" value={draft.name} onChange={(event) => set("name", event.currentTarget.value)} /></label>
      <label>标题格式<input aria-label="标题格式" value={draft.titlePattern} onChange={(event) => set("titlePattern", event.currentTarget.value)} /></label>
      <label>开头固定段落<textarea aria-label="开头固定段落" value={draft.openingText} onChange={(event) => set("openingText", event.currentTarget.value)} /></label>
      <label>总体要求标题<input aria-label="总体要求标题" value={draft.generalHeading ?? ""} onChange={(event) => set("generalHeading", event.currentTarget.value)} /></label>
      <label>总体要求（每行一条）<textarea aria-label="总体要求" value={draft.requirements.join("\n")} onChange={(event) => set("requirements", event.currentTarget.value.split("\n").map((value) => value.trim()).filter(Boolean))} /></label>
      <label>总体情况标题<input aria-label="总体情况标题" value={draft.situationHeading ?? ""} onChange={(event) => set("situationHeading", event.currentTarget.value)} /></label>
      <label>结尾固定段落<textarea aria-label="结尾固定段落" value={draft.closingText} onChange={(event) => set("closingText", event.currentTarget.value)} /></label>
      <label>单位名称<input aria-label="单位名称" value={draft.organizationName} onChange={(event) => set("organizationName", event.currentTarget.value)} /></label>
      <label>正文字体<input aria-label="正文字体" value={draft.bodyFont} onChange={(event) => set("bodyFont", event.currentTarget.value)} /></label>
      <label>小标题字体<input aria-label="小标题字体" value={draft.headingFont} onChange={(event) => set("headingFont", event.currentTarget.value)} /></label>
      <label>标题字体<input aria-label="标题字体" value={draft.titleFont} onChange={(event) => set("titleFont", event.currentTarget.value)} /></label>
      <label>正文字号<input aria-label="正文字号" value={bodyFontSizeInput} onChange={(event) => setBodyFontSizeInput(event.currentTarget.value)} /></label>
      <label>正文首行缩进（字符）<input aria-label="正文首行缩进" value={firstLineIndentInput} onChange={(event) => setFirstLineIndentInput(event.currentTarget.value)} /></label>
      <label>标题字号<input aria-label="标题字号" type="number" min="1" value={draft.titleFontSizePt} onChange={(event) => set("titleFontSizePt", Number(event.currentTarget.value))} /></label>
      <label>行距<input aria-label="行距" type="number" min="0.1" step="0.1" value={draft.lineSpacing} onChange={(event) => set("lineSpacing", Number(event.currentTarget.value))} /></label>
      {(["top", "right", "bottom", "left"] as const).map((side) => <label key={side}>{({ top: "上边距", right: "右边距", bottom: "下边距", left: "左边距" }[side])}<input aria-label={({ top: "上边距", right: "右边距", bottom: "下边距", left: "左边距" }[side])} type="number" min="0" value={draft.marginMm[side]} onChange={(event) => setMargin(side, Number(event.currentTarget.value))} /></label>)}
      <label>照片间距<input aria-label="照片间距" type="number" min="0" value={draft.photoGapPt} onChange={(event) => set("photoGapPt", Number(event.currentTarget.value))} /></label>
      <label>照片排版模式<select aria-label="照片排版模式" value={draft.photoLayoutMode} onChange={(event) => set("photoLayoutMode", event.currentTarget.value as PhotoLayoutMode)}><option value="adaptive">自适应</option><option value="fixed">固定</option></select></label>
      <label>每行照片数<select aria-label="每行照片数" value={draft.photosPerRow} onChange={(event) => set("photosPerRow", Number(event.currentTarget.value) as PhotosPerRow)}>{PHOTO_ROW_COUNTS.map((count) => <option key={count} value={count}>{count}张</option>)}</select></label>
      <label>落款日期格式<input aria-label="落款日期格式" value={draft.signatureDatePattern} onChange={(event) => set("signatureDatePattern", event.currentTarget.value)} /></label>
    </div>
    <section className="template-sections"><h3>照片章节</h3>{draft.sections.map((section, index) => <div key={section.category} className="template-section"><strong>{section.category === "good" ? "好的方面" : section.category === "reminder" ? "提醒事项" : "考核问题"}</strong><label>章节名称<input aria-label={`${section.category}章节名称`} value={section.title} onChange={(event) => setSection(index, { title: event.currentTarget.value })} /></label><label>章节顺序<input aria-label={`${section.category}章节顺序`} type="number" min="0" value={section.order} onChange={(event) => setSection(index, { order: Number(event.currentTarget.value) })} /></label></div>)}</section>
    <div className="page-actions"><Link className="secondary-action" to="/settings">返回设置</Link><button type="button" className="primary-action" disabled={saving} onClick={() => void save()}>{saving ? "正在保存" : "保存为新版本"}</button></div>
  </section>;
}
