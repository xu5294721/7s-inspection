import {
  ClipboardCheck,
  History,
  Home,
  ListChecks,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

interface NavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
  active: (pathname: string) => boolean;
}

const navigation: NavigationItem[] = [
  { label: "首页", to: "/", icon: Home, active: (pathname) => pathname === "/" },
  {
    label: "巡检",
    to: "/inspections/new",
    icon: ClipboardCheck,
    active: (pathname) => pathname.startsWith("/inspections"),
  },
  { label: "历史", to: "/history", icon: History, active: (pathname) => pathname === "/history" || pathname.startsWith("/history/") },
  { label: "项点", to: "/items", icon: ListChecks, active: (pathname) => pathname === "/items" || pathname.startsWith("/items/") },
  { label: "设置", to: "/settings", icon: Settings, active: (pathname) => pathname === "/settings" || pathname.startsWith("/settings/") },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>7S巡检</h1>
      </header>
      <main className="app-content">{children}</main>
      <nav className="bottom-nav" aria-label="主导航">
        {navigation.map(({ label, to, icon: Icon, active }) => {
          const isActive = active(pathname);
          return (
            <Link
              key={to}
              to={to}
              className={isActive ? "bottom-nav__item is-active" : "bottom-nav__item"}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon aria-hidden="true" size={21} strokeWidth={2} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
