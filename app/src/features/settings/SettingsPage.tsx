import { ChevronRight, DatabaseBackup, FileText, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";

export function SettingsPage() {
  return (
    <section className="page-section settings-page">
      <div className="section-heading">
        <p className="eyebrow">应用配置</p>
        <h2>设置</h2>
      </div>
      <div className="settings-group">
        <Link aria-label="Word模板设置" className="settings-link" to="/settings/templates">
          <span className="settings-link__badge is-blue" aria-hidden="true">
            <FileText size={18} strokeWidth={2.1} />
          </span>
          <span className="settings-link__body">
            <strong>Word模板设置</strong>
            <small>保存时创建新版本，历史巡检不受影响</small>
          </span>
          <ChevronRight className="settings-link__chevron" aria-hidden="true" size={18} />
        </Link>
        <Link aria-label="检查内容模板" className="settings-link" to="/settings/check-templates">
          <span className="settings-link__badge is-indigo" aria-hidden="true">
            <SlidersHorizontal size={18} strokeWidth={2.1} />
          </span>
          <span className="settings-link__body">
            <strong>检查内容模板</strong>
            <small>配置大项、小项及默认选项</small>
          </span>
          <ChevronRight className="settings-link__chevron" aria-hidden="true" size={18} />
        </Link>
        <Link aria-label="备份与存储" className="settings-link" to="/settings/backup">
          <span className="settings-link__badge is-green" aria-hidden="true">
            <DatabaseBackup size={18} strokeWidth={2.1} />
          </span>
          <span className="settings-link__body">
            <strong>备份与存储</strong>
            <small>导出恢复本地数据，检查存储空间</small>
          </span>
          <ChevronRight className="settings-link__chevron" aria-hidden="true" size={18} />
        </Link>
      </div>
      <p className="settings-footnote">向塘钢轨焊接整修车间 · 7S 移动巡检本地离线版</p>
    </section>
  );
}
