import { DatabaseBackup, FileText } from "lucide-react";
import { Link } from "react-router-dom";

export function SettingsPage() {
  return <section className="page-section settings-page">
    <div className="section-heading"><p className="eyebrow">应用配置</p><h2>设置</h2></div>
    <Link aria-label="Word模板设置" className="settings-link" to="/settings/templates"><FileText aria-hidden="true" size={22} /><span><strong>Word模板设置</strong><small>保存时创建新版本，历史巡检不受影响</small></span></Link>
    <Link aria-label="备份与存储" className="settings-link" to="/settings/backup"><DatabaseBackup aria-hidden="true" size={22} /><span><strong>备份与存储</strong><small>导出恢复本地数据，检查存储空间</small></span></Link>
  </section>;
}
