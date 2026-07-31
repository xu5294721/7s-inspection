import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAppDependencies } from "../../app/useAppDependencies";
import type { InspectionGraph } from "../../domain/models";

export function TrashPage() {
  const { inspectionRepository } = useAppDependencies();
  const [graphs, setGraphs] = useState<InspectionGraph[]>([]);
  const [pendingPurge, setPendingPurge] = useState<InspectionGraph | null>(null);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const isPurgingRef = useRef(false);
  isPurgingRef.current = isPurging;
  const reload = useCallback(async () => {
    try { setGraphs(await inspectionRepository.listGraphs(true)); setError(""); }
    catch { setError("回收站加载失败，请重试。"); }
  }, [inspectionRepository]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!pendingPurge) return;
    cancelButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPurgingRef.current) {
        event.preventDefault();
        setPendingPurge(null);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
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
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [pendingPurge]);
  useEffect(() => {
    if (!pendingPurge) return;
    if (isPurging) {
      dialogRef.current?.focus();
    } else if (error) {
      cancelButtonRef.current?.focus();
    }
  }, [error, isPurging, pendingPurge]);
  async function restore(id: string) {
    if (restoringId) return;
    setRestoringId(id);
    setError("");
    try { await inspectionRepository.restore(id); await reload(); }
    catch { setError("恢复巡检记录失败，请重试。"); }
    finally { setRestoringId(null); }
  }
  async function purge() {
    if (!pendingPurge || isPurging) return;
    setIsPurging(true);
    setError("");
    try { await inspectionRepository.purgeInspection(pendingPurge.inspection.id); setPendingPurge(null); await reload(); }
    catch { setError("彻底删除失败，请重试。"); }
    finally { setIsPurging(false); }
  }
  function openPurge(graph: InspectionGraph) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError("");
    setPendingPurge(graph);
  }
  return <section className="page-section trash-page">
    <div className="section-heading"><p className="eyebrow">已删除的记录</p><h2>回收站</h2></div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    <ul className="history-list">{graphs.map((graph) => <li key={graph.inspection.id} className="history-row"><div><strong>{graph.inspection.title}</strong><span>删除于 {graph.inspection.deletedAt}</span></div><div className="history-actions"><button type="button" aria-label={`恢复 ${graph.inspection.title}`} disabled={restoringId !== null || isPurging} onClick={() => void restore(graph.inspection.id)}><RotateCcw aria-hidden="true" size={18} />恢复</button><button type="button" aria-label={`彻底删除 ${graph.inspection.title}`} disabled={restoringId !== null || isPurging} onClick={() => openPurge(graph)}><Trash2 aria-hidden="true" size={18} />彻底删除</button></div></li>)}</ul>
    {graphs.length === 0 ? <p className="empty-state">回收站为空。</p> : null}
    <Link className="secondary-action" to="/history">返回巡检历史</Link>
    {pendingPurge ? <div className="confirmation-backdrop"><section ref={dialogRef} className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="purge-title" aria-busy={isPurging} tabIndex={-1}><h3 id="purge-title">确认彻底删除</h3><p>将永久删除“{pendingPurge.inspection.title}”。照片无法恢复。</p><div><button ref={cancelButtonRef} type="button" disabled={isPurging} onClick={() => setPendingPurge(null)}>取消</button><button type="button" className="danger-action" disabled={isPurging} onClick={() => void purge()}>确认彻底删除</button></div></section></div> : null}
  </section>;
}
