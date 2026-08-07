import { DatabaseBackup, FileText } from "lucide-react";
import { Link } from "react-router-dom";

export function SettingsPage() {
  return <section className="page-section settings-page">
    <div className="section-heading"><p className="eyebrow">????</p><h2>??</h2></div>
    <Link aria-label="Word????" className="settings-link" to="/settings/templates"><FileText aria-hidden="true" size={22} /><span><strong>Word????</strong><small>?????????????????</small></span></Link>
    <Link aria-label="??????" className="settings-link" to="/settings/check-templates"><FileText aria-hidden="true" size={22} /><span><strong>??????</strong><small>????????????</small></span></Link>
    <Link aria-label="?????" className="settings-link" to="/settings/backup"><DatabaseBackup aria-hidden="true" size={22} /><span><strong>?????</strong><small>???????????????</small></span></Link>
  </section>;
}
