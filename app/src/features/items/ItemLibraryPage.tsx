import { FileUp, Pencil, Power } from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useAppDependencies } from "../../app/useAppDependencies";
import type { ChecklistItem } from "../../domain/models";
import { applyItemImport, buildImportPreview, parseChecklistWorkbook, type ImportPreview } from "./excelImport";
import { ItemEditor } from "./ItemEditor";

export function ItemLibraryPage() {
  const { itemRepository } = useAppDependencies();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [pendingDisableId, setPendingDisableId] = useState<string | null>(null);
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  const reload = useCallback(async () => {
    try { setItems(await itemRepository.listAll()); setError(""); }
    catch { setError("项点库加载失败，请重试。"); }
  }, [itemRepository]);
  useEffect(() => { void reload(); }, [reload]);
  async function importWorkbook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try { setPreview(buildImportPreview(await parseChecklistWorkbook(file), items)); setError(""); }
    catch { setError("Excel文件读取失败，请确认格式后重试。"); }
  }
  async function applyPreview() {
    if (!preview || isApplyingImport) return;
    setIsApplyingImport(true);
    try { await applyItemImport(preview, itemRepository); setPreview(null); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败，请重试。"); }
    finally { setIsApplyingImport(false); }
  }
  async function disableItem(id: string) {
    if (pendingDisableId) return;
    setPendingDisableId(id);
    setError("");
    try { await itemRepository.disable(id); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "停用项点失败，请重试。"); }
    finally { setPendingDisableId(null); }
  }
  if (editing) return <ItemEditor item={editing} onCancel={() => setEditing(null)} onSave={async (item) => { await itemRepository.put(item); setEditing(null); await reload(); }} />;
  return <section className="page-section item-library-page">
    <div className="section-heading"><p className="eyebrow">检查项目维护</p><h2>项点库</h2></div>
    <label className="secondary-action file-import"><FileUp aria-hidden="true" size={18} />导入Excel项点库<input aria-label="导入Excel项点库" className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={isApplyingImport} onChange={(event) => void importWorkbook(event)} /></label>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {preview ? <section className="import-preview"><h3>导入预览</h3><p>新增 {preview.added.length} · 修改 {preview.changed.length} · 停用 {preview.disabled.length} · 错误 {preview.errors.length}</p>{preview.errors.length ? <table><thead><tr><th>行</th><th>字段</th><th>错误</th></tr></thead><tbody>{preview.errors.map((item) => <tr key={`${item.row}-${item.field}-${item.message}`}><td>{item.row}</td><td>{item.field}</td><td>{item.message}</td></tr>)}</tbody></table> : null}<div className="page-actions"><button type="button" className="secondary-action" disabled={isApplyingImport} onClick={() => setPreview(null)}>取消</button><button type="button" className="primary-action" disabled={preview.errors.length > 0 || isApplyingImport} onClick={() => void applyPreview()}>确认导入</button></div></section> : null}
    <ul className="item-library-list">{items.map((item) => <li key={item.id}><div><strong>{item.standard}</strong><span>{item.routeName} · {item.area} · {item.part}</span>{!item.enabled ? <em>已停用</em> : null}</div><div className="history-actions"><button type="button" aria-label={`编辑 ${item.standard}`} disabled={pendingDisableId !== null} onClick={() => setEditing(item)}><Pencil aria-hidden="true" size={18} />编辑</button>{item.enabled ? <button type="button" aria-label={`停用 ${item.standard}`} disabled={pendingDisableId !== null} onClick={() => void disableItem(item.id)}><Power aria-hidden="true" size={18} />停用</button> : null}</div></li>)}</ul>
  </section>;
}
