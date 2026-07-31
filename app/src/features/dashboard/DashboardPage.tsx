import { useEffect, useState } from "react";
import { ClipboardCheck, DatabaseBackup, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppDependencies } from "../../app/useAppDependencies";
import type { BackupReminderState } from "../../db/backupRepository";

export function DashboardPage() {
  const { backupRepository, now } = useAppDependencies();
  const [reminder, setReminder] = useState<BackupReminderState | null>(null);
  const [dismissError, setDismissError] = useState("");

  useEffect(() => {
    let active = true;
    backupRepository.readBackupReminder().then(
      (state) => active && setReminder(state),
      () => active && setReminder(null),
    );
    return () => {
      active = false;
    };
  }, [backupRepository]);

  async function dismissReminder() {
    if (!reminder) return;
    setDismissError("");
    try {
      await backupRepository.dismissBackupReminder(reminder.milestone, now().toISOString());
      setReminder({ ...reminder, dismissedMilestone: reminder.milestone, visible: false });
    } catch {
      setDismissError("备份提醒关闭状态保存失败，请重试。");
    }
  }

  return (
    <section className="page-section dashboard-page">
      <div className="section-heading">
        <p className="eyebrow">向塘钢轨焊接整修车间</p>
        <h2>首页</h2>
      </div>
      <div className="dashboard-action">
        <div>
          <strong>现场7S巡检</strong>
          <p>按路线选择本次检查项点</p>
        </div>
        <Link className="primary-action" to="/inspections/new">
          <ClipboardCheck aria-hidden="true" size={20} />
          开始巡检
        </Link>
      </div>
      {reminder?.visible ? (
        <section className="backup-reminder" role="region" aria-label="备份提醒">
          <DatabaseBackup aria-hidden="true" size={22} />
          <div>
            <strong>请备份本地数据</strong>
            <p>已生成{reminder.milestone}份巡检通报，建议立即导出一份ZIP备份。</p>
            <Link to="/settings/backup">立即备份</Link>
          </div>
          <button
            type="button"
            aria-label="暂时关闭备份提醒"
            title="暂时关闭"
            onClick={() => void dismissReminder()}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </section>
      ) : null}
      {dismissError ? <p className="inline-error" role="alert">{dismissError}</p> : null}
    </section>
  );
}
