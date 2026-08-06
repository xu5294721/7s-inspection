import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArchiveRestore, DatabaseBackup, HardDrive, ShieldCheck } from "lucide-react";
import { useAppDependencies } from "../../app/useAppDependencies";
import {
  storageCapacityState,
  type BackupPreview,
  type PersistentStorageStatus,
  type RestoreMode,
  type RestoreResult,
} from "../../db/backupRepository";

type PendingAction = "export" | "inspect" | "restore" | "persist" | null;
type PersistenceView = PersistentStorageStatus | "not-requested";

const countLabels: Array<[keyof BackupPreview["counts"], string]> = [
  ["checklistItems", "巡检项点"],
  ["templates", "Word模板"],
  ["routeTemplates", "路线模板"],
  ["inspections", "巡检记录"],
  ["entries", "巡检条目"],
  ["photoGroups", "照片组"],
  ["photos", "照片"],
  ["settings", "设置"],
];

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function backupFilename(now: Date): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `7S巡检备份-${stamp}.zip`;
}

export function BackupPage() {
  const { backupRepository, now } = useAppDependencies();
  const supportsPersistence = typeof navigator !== "undefined" &&
    typeof navigator.storage?.persist === "function";
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [confirmMode, setConfirmMode] = useState<RestoreMode | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [persistence, setPersistence] = useState<PersistenceView>(
    supportsPersistence ? "not-requested" : "unsupported",
  );
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef<PendingAction>(null);

  function beginAction(action: Exclude<PendingAction, null>): boolean {
    if (pendingRef.current !== null) return false;
    pendingRef.current = action;
    setPending(action);
    return true;
  }

  function endAction(): void {
    pendingRef.current = null;
    setPending(null);
  }

  async function refreshEstimate() {
    setEstimate(await backupRepository.readStorageEstimate());
  }

  useEffect(() => {
    let active = true;
    backupRepository.readStorageEstimate().then((value) => {
      if (active) setEstimate(value);
    });
    return () => {
      active = false;
    };
  }, [backupRepository]);

  useEffect(() => {
    if (!confirmMode) return;
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && pendingRef.current !== "restore") {
        event.preventDefault();
        setConfirmMode(null);
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
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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
  }, [confirmMode]);

  useEffect(() => {
    if (!confirmMode) return;
    if (pending === "restore") {
      dialogRef.current?.focus();
    } else if (error) {
      cancelButtonRef.current?.focus();
    }
  }, [confirmMode, error, pending]);

  async function exportBackup() {
    if (!beginAction("export")) return;
    setError("");
    setMessage("");
    try {
      await backupRepository.createBackupToDownloads(backupFilename(now()));
      setMessage("备份文件已保存，请妥善保存。 ");
      await refreshEstimate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "备份导出失败，请重试。");
    } finally {
      endAction();
    }
  }

  async function selectRestoreFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    setRestoreFile(file);
    setPreview(null);
    setRestoreResult(null);
    setConfirmMode(null);
    setError("");
    setMessage("");
    if (!file) return;
    if (!beginAction("inspect")) return;
    try {
      setPreview(await backupRepository.inspectBackup(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "备份文件检查失败，请重新选择。");
    } finally {
      endAction();
    }
  }

  async function confirmRestore() {
    if (!restoreFile || !confirmMode || !beginAction("restore")) return;
    const mode = confirmMode;
    setError("");
    setMessage("");
    try {
      const result = await backupRepository.restoreBackup(restoreFile, mode);
      setRestoreResult(result);
      setMessage(mode === "replace" ? "本地数据已从备份完整恢复。" : "备份数据已完成合并。 ");
      await refreshEstimate();
      setConfirmMode(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复失败，本地数据未发生变更。");
    } finally {
      endAction();
    }
  }

  async function persistStorage() {
    if (!beginAction("persist")) return;
    setError("");
    try {
      setPersistence(await backupRepository.requestPersistentStorage());
    } catch {
      setPersistence("denied");
    } finally {
      endAction();
    }
  }

  function openRestoreConfirmation(mode: RestoreMode): void {
    if (pendingRef.current !== null) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError("");
    setMessage("");
    setConfirmMode(mode);
  }

  const capacity = storageCapacityState(estimate);
  const disabled = pending !== null;

  return (
    <section className="page-section backup-page">
      <div className="section-heading">
        <p className="eyebrow">本地数据保护</p>
        <h2>备份与存储</h2>
      </div>

      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {message ? <p className="inline-success" role="status">{message}</p> : null}

      <section className="backup-section" aria-labelledby="backup-export-heading">
        <div className="backup-section__heading">
          <DatabaseBackup aria-hidden="true" size={22} />
          <div><h3 id="backup-export-heading">导出本地备份</h3><p>包含巡检记录、模板、设置及全部原图和缩略图。</p></div>
        </div>
        <button className="primary-action" type="button" disabled={disabled} onClick={() => void exportBackup()}>
          {pending === "export" ? "正在生成..." : "导出ZIP备份"}
        </button>
      </section>

      <section className="backup-section" aria-labelledby="backup-restore-heading">
        <div className="backup-section__heading">
          <ArchiveRestore aria-hidden="true" size={22} />
          <div><h3 id="backup-restore-heading">从备份恢复</h3><p>先检查文件和数据数量，再选择替换或合并。</p></div>
        </div>
        <label className="backup-file-input">
          <span>选择备份文件</span>
          <input type="file" accept=".zip,application/zip" disabled={disabled} onChange={(event) => void selectRestoreFile(event)} />
        </label>
        {pending === "inspect" ? <p className="status-message" role="status">正在校验备份文件...</p> : null}
        {preview ? (
          <section className="restore-preview" role="region" aria-label="恢复预览">
            <h4>恢复预览</h4>
            <p>备份时间：{new Date(preview.createdAt).toLocaleString("zh-CN")}</p>
            <ul>
              {countLabels.map(([key, label]) => <li key={key}><span>{label}</span><strong>{preview.counts[key]} 条</strong></li>)}
            </ul>
            <p className="status-message">
              合并预计新增 {preview.mergeRouteTemplates.added} 个路线模板，跳过 {preview.mergeRouteTemplates.skipped} 个路线模板。
            </p>
            <div className="page-actions">
              <button className="secondary-action" type="button" disabled={disabled} onClick={() => openRestoreConfirmation("merge")}>合并恢复</button>
              <button className="danger-action" type="button" disabled={disabled} onClick={() => openRestoreConfirmation("replace")}>替换恢复</button>
            </div>
          </section>
        ) : null}
        {restoreResult ? (
          <p className="restore-result" role="status">
            <span>已导入 {restoreResult.importedInspectionCount} 份巡检，跳过 {restoreResult.skippedInspectionCount} 份巡检。</span>{" "}
            <span>已导入 {restoreResult.importedCounts.routeTemplates} 个路线模板，跳过 {restoreResult.skippedRouteTemplateCount} 个路线模板。</span>
          </p>
        ) : null}
      </section>

      <section className="backup-section" role="region" aria-label="存储空间">
        <div className="backup-section__heading">
          <HardDrive aria-hidden="true" size={22} />
          <div><h3>存储空间</h3><p>浏览器本地空间不足时，请先备份并删除不再需要的数据。</p></div>
        </div>
        {capacity.percentage === null ? (
          <p className="storage-unavailable">浏览器未提供完整的存储用量信息。</p>
        ) : (
          <dl className="storage-metrics">
            <div><dt>已使用</dt><dd>{formatBytes(capacity.usage ?? 0)}</dd></div>
            <div><dt>总容量</dt><dd>{formatBytes(capacity.quota ?? 0)}</dd></div>
            <div><dt>可用</dt><dd>{formatBytes(capacity.available ?? 0)}</dd></div>
            <div><dt>使用率</dt><dd>{capacity.percentage.toFixed(1)}%</dd></div>
          </dl>
        )}
        {capacity.warning ? (
          <p className="storage-warning" role="alert">
            {capacity.photoWriteBlocked
              ? "空间使用率已达到95%，新照片已暂停保存。请先备份或删除数据。"
              : "空间使用率已达到80%，请尽快导出备份并清理不再需要的数据。"}
          </p>
        ) : null}
      </section>

      <section className="backup-section" aria-labelledby="persistence-heading">
        <div className="backup-section__heading">
          <ShieldCheck aria-hidden="true" size={22} />
          <div><h3 id="persistence-heading">持久存储</h3><p>授权后，浏览器会尽量避免自动清理本应用的本地数据。</p></div>
        </div>
        <p className="persistence-status" role="status">
          {persistence === "granted" ? "持久存储已授权" : null}
          {persistence === "denied" ? "持久存储申请未获授权" : null}
          {persistence === "unsupported" ? "当前浏览器不支持持久存储申请" : null}
          {persistence === "not-requested" ? "尚未申请持久存储" : null}
        </p>
        <button
          className="secondary-action"
          type="button"
          disabled={disabled || persistence === "unsupported"}
          onClick={() => void persistStorage()}
        >
          {pending === "persist" ? "正在申请..." : "申请持久存储"}
        </button>
      </section>

      {confirmMode ? (
        <div className="confirmation-backdrop">
          <section
            ref={dialogRef}
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-confirm-title"
            aria-busy={pending === "restore"}
            tabIndex={-1}
          >
            <h3 id="restore-confirm-title">
              {confirmMode === "replace" ? "确认替换当前数据" : "确认合并备份"}
            </h3>
            <p>
              {confirmMode === "replace"
                ? "当前本地数据将被备份中的数据全部替换。此操作开始前会再次完整校验备份，恢复失败不会保留部分数据。"
                : "备份中的新巡检将合并到本地；已有或发生编号冲突的巡检会整份跳过。"}
            </p>
            <div>
              <button
                ref={cancelButtonRef}
                type="button"
                disabled={pending === "restore"}
                onClick={() => setConfirmMode(null)}
              >
                取消
              </button>
              <button
                className={confirmMode === "replace" ? "danger-action" : "primary-action"}
                type="button"
                disabled={pending === "restore"}
                onClick={() => void confirmRestore()}
              >
                {confirmMode === "replace" ? "确认替换" : "确认合并"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
