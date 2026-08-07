import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { TrashPage } from "../features/history/TrashPage";
import { InspectionPage } from "../features/inspections/InspectionPage";
import { NewInspectionPage } from "../features/inspections/NewInspectionPage";
import { ItemLibraryPage } from "../features/items/ItemLibraryPage";
import { RouteTemplateManagementPage } from "../features/routeTemplates/RouteTemplateManagementPage";
import { ReviewPage } from "../features/review/ReviewPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { BackupPage } from "../features/settings/BackupPage";
import { TemplateSettingsPage } from "../features/settings/TemplateSettingsPage";
import { InspectionCheckTemplatePage } from "../features/settings/InspectionCheckTemplatePage";

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="page-section">
      <h2>{title}</h2>
      <p className="empty-state">?????????????</p>
    </section>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/inspections" element={<Navigate to="/inspections/new" replace />} />
      <Route path="/inspections/new" element={<NewInspectionPage />} />
      <Route path="/inspections/route-templates" element={<RouteTemplateManagementPage />} />
      <Route path="/inspections/:id/review" element={<ReviewPage />} />
      <Route path="/inspections/:id" element={<InspectionPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/history/trash" element={<TrashPage />} />
      <Route path="/items" element={<ItemLibraryPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/backup" element={<BackupPage />} />
      <Route path="/settings/templates" element={<TemplateSettingsPage />} />
      <Route path="/settings/check-templates" element={<InspectionCheckTemplatePage />} />
      <Route path="*" element={<PlaceholderPage title="?????" />} />
    </Routes>
  );
}
