import { Copy, Eye, FileOutput, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppDependencies } from "../../app/useAppDependencies";
import { createInspection } from "../../domain/inspection";
import type { ChecklistItem, InspectionGraph, PhotoCategory } from "../../domain/models";
import { toLocalInspectionDate } from "../../lib/dates";
import { isPrefixedBrowserUuid } from "../../lib/ids";

const categoryLabels: Record<PhotoCategory, string> = {
  good: "较好",
  reminder: "提醒",
  assessment: "考核",
};

function copiedItems(graph: InspectionGraph): ChecklistItem[] {
  return graph.inspection.entries
    .filter((entry) => !(
      isPrefixedBrowserUuid(entry.id, "temporary-entry") &&
      isPrefixedBrowserUuid(entry.itemId, "temporary-item")
    ))
    .map((entry) => ({
      ...entry.itemSnapshot,
      quickPhrases: [...entry.itemSnapshot.quickPhrases],
      enabled: true,
      createdAt: graph.inspection.createdAt,
      updatedAt: graph.inspection.updatedAt,
    }));
}

function HistorySummary({ graph }: { graph: InspectionGraph }) {
  const counts: Record<PhotoCategory, number> = { good: 0, reminder: 0, assessment: 0 };
  let rewards = 0;
  let assessments = 0;
  for (const group of graph.groups) {
    counts[group.category] += group.photoIds.length;
    if (group.awardAssessment?.type === "reward") rewards += group.awardAssessment.amount;
    if (group.awardAssessment?.type === "assessment") assessments += group.awardAssessment.amount;
  }
  return (
    <div className="history-summary" aria-label="巡检汇总">
      <span>较好 {counts.good}</span><span>提醒 {counts.reminder}</span><span>考核 {counts.assessment}</span>
      <span>照片 {graph.photos.length}</span><span>奖励 {rewards}元</span><span>考核 {assessments}元</span>
    </div>
  );
}

function HistoryRow({
  graph,
  pendingCopyId,
  pendingDeleteId,
  onCopy,
  onDelete,
}: {
  graph: InspectionGraph;
  pendingCopyId: string | null;
  pendingDeleteId: string | null;
  onCopy(graph: InspectionGraph): void;
  onDelete(id: string): void;
}) {
  const isDraft = graph.inspection.status === "draft";
  return <li className="history-row">
    <div>
      <strong>{graph.inspection.title}</strong>
      <span>{graph.inspection.inspectionDate} · {isDraft ? "草稿，已自动保存" : graph.inspection.status === "reviewed" ? "已复核" : "已生成"}</span>
    </div>
    <HistorySummary graph={graph} />
    <div className="history-actions">
      <Link aria-label={`${isDraft ? "继续巡检" : "打开"} ${graph.inspection.title}`} to={`/inspections/${graph.inspection.id}`}>
        <Eye aria-hidden="true" size={18} />{isDraft ? "继续巡检" : "打开"}
      </Link>
      {!isDraft ? <Link aria-label={`重新生成 ${graph.inspection.title}`} to={`/inspections/${graph.inspection.id}/review`}><FileOutput aria-hidden="true" size={18} />重新生成</Link> : null}
      <button type="button" aria-label={`复制为新巡检 ${graph.inspection.title}`} disabled={pendingCopyId !== null} onClick={() => onCopy(graph)}><Copy aria-hidden="true" size={18} />复制</button>
      <button type="button" aria-label={`删除 ${graph.inspection.title}`} disabled={pendingDeleteId !== null} onClick={() => onDelete(graph.inspection.id)}><Trash2 aria-hidden="true" size={18} />删除</button>
    </div>
  </li>;
}

export function HistoryPage() {
  const { inspectionRepository, createInspectionId, now } = useAppDependencies();
  const navigate = useNavigate();
  const [graphs, setGraphs] = useState<InspectionGraph[]>([]);
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState<"" | PhotoCategory>("");
  const [people, setPeople] = useState("");
  const [error, setError] = useState("");
  const [pendingCopyId, setPendingCopyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setGraphs(await inspectionRepository.listGraphs(false));
      setError("");
    } catch {
      setError("历史巡检记录加载失败，请重试。");
    }
  }, [inspectionRepository]);

  useEffect(() => { void reload(); }, [reload]);

  const visible = useMemo(() => {
    const normalizedText = text.trim().toLocaleLowerCase("zh-CN");
    const normalizedPeople = people.trim().toLocaleLowerCase("zh-CN");
    return graphs.filter((graph) => {
      if (date && graph.inspection.inspectionDate !== date) return false;
      if (normalizedText && !graph.inspection.entries.some((entry) =>
        [entry.itemSnapshot.routeName, entry.itemSnapshot.area].join(" ").toLocaleLowerCase("zh-CN").includes(normalizedText))) return false;
      if (category && !graph.groups.some((group) => group.category === category)) return false;
      if (normalizedPeople && !graph.groups.some((group) =>
        group.awardAssessment?.people.toLocaleLowerCase("zh-CN").includes(normalizedPeople))) return false;
      return true;
    });
  }, [category, date, graphs, people, text]);
  const drafts = visible.filter((graph) => graph.inspection.status === "draft");
  const completed = visible.filter((graph) => graph.inspection.status !== "draft");

  async function copyInspection(graph: InspectionGraph) {
    if (pendingCopyId) return;
    setPendingCopyId(graph.inspection.id);
    setError("");
    try {
      const inspectionId = createInspectionId();
      const inspection = createInspection(copiedItems(graph), inspectionId, toLocalInspectionDate(now()));
      inspection.templateId = graph.inspection.templateId;
      inspection.templateVersion = graph.inspection.templateVersion;
      await inspectionRepository.saveGraph({ inspection, groups: [], photos: [] });
      navigate(`/inspections/${inspectionId}`);
    } catch {
      setError("复制巡检记录失败，请重试。");
    } finally {
      setPendingCopyId(null);
    }
  }

  async function moveToTrash(id: string) {
    if (pendingDeleteId) return;
    setPendingDeleteId(id);
    setError("");
    try {
      await inspectionRepository.moveToTrash(id, now().toISOString());
      await reload();
    } catch {
      setError("删除巡检记录失败，请重试。");
    } finally {
      setPendingDeleteId(null);
    }
  }

  return <section className="page-section history-page">
    <div className="section-heading"><p className="eyebrow">已保存的巡检通报</p><h2>巡检历史</h2></div>
    <div className="history-filter" aria-label="历史筛选">
      <label>巡检日期<input aria-label="巡检日期" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} /></label>
      <label className="search-control"><span className="sr-only">按路线或区域筛选</span><input type="search" aria-label="按路线或区域筛选" value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="路线或区域" /></label>
      <label>检查类别<select aria-label="按类别筛选" value={category} onChange={(event) => setCategory(event.currentTarget.value as "" | PhotoCategory)}><option value="">全部类别</option>{(Object.keys(categoryLabels) as PhotoCategory[]).map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}</select></label>
      <label>相关人员<input aria-label="按人员筛选" value={people} onChange={(event) => setPeople(event.currentTarget.value)} /></label>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {drafts.length > 0 ? <section className="history-resume-section" aria-label="待继续巡检">
      <h3>待继续巡检</h3>
      <ul className="history-list">{drafts.map((graph) => <HistoryRow key={graph.inspection.id} graph={graph} pendingCopyId={pendingCopyId} pendingDeleteId={pendingDeleteId} onCopy={(item) => void copyInspection(item)} onDelete={(id) => void moveToTrash(id)} />)}</ul>
    </section> : null}
    {completed.length > 0 ? <ul className="history-list">{completed.map((graph) => <HistoryRow key={graph.inspection.id} graph={graph} pendingCopyId={pendingCopyId} pendingDeleteId={pendingDeleteId} onCopy={(item) => void copyInspection(item)} onDelete={(id) => void moveToTrash(id)} />)}</ul> : null}
    {visible.length === 0 ? <p className="empty-state">没有符合筛选条件的巡检记录。</p> : null}
    <Link className="secondary-action history-trash-link" to="/history/trash">查看回收站</Link>
  </section>;
}
