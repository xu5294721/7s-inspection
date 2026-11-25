import { useEffect, useState } from "react";
import {
  ChevronRight,
  ClipboardCheck,
  Clock,
  DatabaseBackup,
  FileCheck2,
  ListChecks,
  MapPin,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAppDependencies } from "../../app/useAppDependencies";
import type { BackupReminderState } from "../../db/backupRepository";
import type { InspectionGraph } from "../../domain/models";
import { toLocalInspectionDateTime } from "../../lib/dates";

interface DashboardOverview {
  latestDraft: InspectionGraph | null;
  draftCount: number;
  completedCount: number;
  templateCount: number;
}

function completedEntryCount(graph: InspectionGraph): number {
  const completedIds = new Set(graph.groups.map((group) => group.entryId));
  return graph.inspection.entries.filter((entry) => completedIds.has(entry.id)).length;
}

export function DashboardPage() {
  const { backupRepository, inspectionRepository, routeTemplateRepository, now } = useAppDependencies();
  const [reminder, setReminder] = useState<BackupReminderState | null>(null);
  const [overview, setOverview] = useState<DashboardOverview>({
    latestDraft: null,
    draftCount: 0,
    completedCount: 0,
    templateCount: 0,
  });
  const [dismissError, setDismissError] = useState("");

  useEffect(() => {
    let active = true;
    backupRepository.readBackupReminder().then(
      (state) => active && setReminder(state),
      () => active && setReminder(null),
    );
    Promise.all([
      inspectionRepository.listGraphs(false).catch(() => [] as InspectionGraph[]),
      routeTemplateRepository.list().catch(() => []),
    ]).then(([graphs, templates]) => {
      if (!active) return;
      const drafts = graphs.filter((graph) => graph.inspection.status === "draft");
      const completed = graphs.filter((graph) => graph.inspection.status !== "draft");
      setOverview({
        latestDraft: drafts[0] ?? null,
        draftCount: drafts.length,
        completedCount: completed.length,
        templateCount: templates.length,
      });
    });
    return () => {
      active = false;
    };
  }, [backupRepository, inspectionRepository, routeTemplateRepository]);

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

  const latestDraft = overview.latestDraft;
  const draftTotal = latestDraft?.inspection.entries.length ?? 0;
  const draftDone = latestDraft ? completedEntryCount(latestDraft) : 0;
  const draftRatio = draftTotal > 0 ? Math.round((draftDone / draftTotal) * 100) : 0;

  return (
    <section className="page-section dashboard-page">
      <div className="section-heading">
        <p className="eyebrow">向塘钢轨焊接整修车间</p>
        <h2>首页</h2>
      </div>

      <div className="dashboard-stack">
        <div className="dashboard-action">
          <div className="dashboard-action__lead">
            <span className="dashboard-action__badge" aria-hidden="true">
              <ClipboardCheck size={24} strokeWidth={2.1} />
            </span>
            <div className="dashboard-action__copy">
              <strong>现场7S巡检</strong>
              <p>按路线选择本次检查项点，自动生成 Word 通报</p>
            </div>
          </div>
          <Link className="primary-action" to="/inspections/new">
            <ClipboardCheck aria-hidden="true" size={18} />
            开始巡检
          </Link>
        </div>

        {latestDraft ? (
          <section className="dashboard-resume" aria-label="继续上次巡检">
            <div className="dashboard-resume__top">
              <div>
                <span className="dashboard-resume__pill">
                  <Clock aria-hidden="true" size={12} />
                  进行中草稿
                </span>
                <strong>{latestDraft.inspection.title}</strong>
                <p className="dashboard-resume__meta">
                  更新于 {toLocalInspectionDateTime(latestDraft.inspection.inspectionDate, latestDraft.inspection.updatedAt)} · 已完成 {draftDone}/{draftTotal} 项
                </p>
              </div>
            </div>
            <div className="ios-progress-track" aria-hidden="true">
              <div className="ios-progress-fill" style={{ width: `${draftRatio}%` }} />
            </div>
            <div className="dashboard-resume__footer">
              <span className="dashboard-resume__meta">照片 {latestDraft.photos.length} 张</span>
              <Link className="secondary-action" to={`/inspections/${latestDraft.inspection.id}`}>
                继续上次巡检
                <ChevronRight aria-hidden="true" size={16} />
              </Link>
            </div>
          </section>
        ) : null}

        <div className="dashboard-bento" aria-label="巡检数据概览">
          <Link className="dashboard-tile" to="/history">
            <span className="dashboard-tile__icon is-orange" aria-hidden="true">
              <Clock size={17} strokeWidth={2.2} />
            </span>
            <strong className="dashboard-tile__value">{overview.draftCount}</strong>
            <span className="dashboard-tile__label">待继续草稿</span>
          </Link>
          <Link className="dashboard-tile" to="/history">
            <span className="dashboard-tile__icon is-green" aria-hidden="true">
              <FileCheck2 size={17} strokeWidth={2.2} />
            </span>
            <strong className="dashboard-tile__value">{overview.completedCount}</strong>
            <span className="dashboard-tile__label">已生成通报</span>
          </Link>
          <Link className="dashboard-tile" to="/inspections/route-templates">
            <span className="dashboard-tile__icon is-indigo" aria-hidden="true">
              <MapPin size={17} strokeWidth={2.2} />
            </span>
            <strong className="dashboard-tile__value">{overview.templateCount}</strong>
            <span className="dashboard-tile__label">路线模板</span>
          </Link>
        </div>

        {reminder?.visible ? (
          <section className="backup-reminder" role="region" aria-label="备份提醒">
            <span className="backup-reminder__icon" aria-hidden="true">
              <DatabaseBackup size={18} strokeWidth={2.1} />
            </span>
            <div>
              <strong>请备份本地数据</strong>
              <p>已生成{reminder.milestone}份巡检通报，建议立即导出一份ZIP备份。</p>
              <Link to="/settings/backup">
                立即备份
                <ChevronRight aria-hidden="true" size={15} />
              </Link>
            </div>
            <button
              type="button"
              aria-label="暂时关闭备份提醒"
              title="暂时关闭"
              onClick={() => void dismissReminder()}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </section>
        ) : null}
        {dismissError ? <p className="inline-error" role="alert">{dismissError}</p> : null}

        <div className="dashboard-quick-group" aria-label="常用配置">
          <Link className="dashboard-quick-row" to="/inspections/route-templates">
            <span className="settings-link__badge is-blue" aria-hidden="true">
              <MapPin size={17} strokeWidth={2.1} />
            </span>
            <span className="dashboard-quick-row__copy">
              <strong>巡检路线模板</strong>
              <small>维护固定检查路线与排序</small>
            </span>
            <ChevronRight className="dashboard-quick-row__chevron" aria-hidden="true" size={18} />
          </Link>
          <Link className="dashboard-quick-row" to="/settings/check-templates">
            <span className="settings-link__badge is-indigo" aria-hidden="true">
              <SlidersHorizontal size={17} strokeWidth={2.1} />
            </span>
            <span className="dashboard-quick-row__copy">
              <strong>检查内容模板</strong>
              <small>配置默认大项与预选小项</small>
            </span>
            <ChevronRight className="dashboard-quick-row__chevron" aria-hidden="true" size={18} />
          </Link>
          <Link className="dashboard-quick-row" to="/items">
            <span className="settings-link__badge is-green" aria-hidden="true">
              <ListChecks size={17} strokeWidth={2.1} />
            </span>
            <span className="dashboard-quick-row__copy">
              <strong>项点标准库</strong>
              <small>管理车间检查项点与 Excel 导入</small>
            </span>
            <ChevronRight className="dashboard-quick-row__chevron" aria-hidden="true" size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}
