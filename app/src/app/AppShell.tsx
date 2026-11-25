import {
  ChevronLeft,
  ClipboardCheck,
  History,
  Home,
  ListChecks,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

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

interface RouteNavMeta {
  title: string;
  isRoot: boolean;
  backTo?: string;
  backLabel?: string;
}

function getRouteNavMeta(pathname: string): RouteNavMeta {
  if (pathname === "/") return { title: "7S巡检", isRoot: true };
  if (pathname === "/inspections/new" || pathname === "/inspections") {
    return { title: "新建巡检", isRoot: true };
  }
  if (pathname === "/inspections/route-templates") {
    return { title: "路线模板", isRoot: false, backTo: "/inspections/new", backLabel: "巡检" };
  }
  if (/^\/inspections\/[^/]+\/review$/.test(pathname)) {
    const inspectionPath = pathname.replace(/\/review$/, "");
    return { title: "通报复核", isRoot: false, backTo: inspectionPath, backLabel: "现场检查" };
  }
  if (/^\/inspections\/[^/]+$/.test(pathname)) {
    return { title: "现场检查", isRoot: false, backTo: "/history", backLabel: "返回" };
  }
  if (pathname === "/history") return { title: "巡检历史", isRoot: true };
  if (pathname === "/history/trash") {
    return { title: "回收站", isRoot: false, backTo: "/history", backLabel: "历史" };
  }
  if (pathname === "/items") return { title: "项点库", isRoot: true };
  if (pathname === "/settings") return { title: "设置", isRoot: true };
  if (pathname === "/settings/templates") {
    return { title: "Word模板", isRoot: false, backTo: "/settings", backLabel: "设置" };
  }
  if (pathname === "/settings/check-templates") {
    return { title: "检查内容模板", isRoot: false, backTo: "/settings", backLabel: "设置" };
  }
  if (pathname === "/settings/backup") {
    return { title: "备份与存储", isRoot: false, backTo: "/settings", backLabel: "设置" };
  }
  return { title: "7S巡检", isRoot: true };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const meta = getRouteNavMeta(pathname);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  function handleBack() {
    if (meta.backTo) {
      navigate(meta.backTo);
    } else {
      navigate(-1);
    }
  }

  return (
    <div className="app-shell">
      <header className={`topbar${scrolled ? " is-scrolled" : ""}${meta.isRoot ? " is-root" : " is-subpage"}`}>
        <div className="topbar__inner">
          <div className="topbar__leading">
            {!meta.isRoot ? (
              <button
                type="button"
                className="topbar__back"
                aria-label={`返回${meta.backLabel ?? "上一页"}`}
                onClick={handleBack}
              >
                <ChevronLeft aria-hidden="true" size={20} strokeWidth={2.4} />
                <span>{meta.backLabel ?? "返回"}</span>
              </button>
            ) : (
              <span className="topbar__brand-mark" aria-hidden="true">
                <span className="topbar__brand-dot" />
                <span>向塘焊轨车间</span>
              </span>
            )}
          </div>
          {meta.isRoot ? (
            <h1 className={`topbar__title${pathname !== "/" && !scrolled ? " is-subtle" : ""}`}>
              7S巡检
            </h1>
          ) : (
            <span className="topbar__title">{meta.title}</span>
          )}
          <div className="topbar__trailing" aria-hidden="true" />
        </div>
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
              <span className="bottom-nav__icon">
                <Icon aria-hidden="true" size={21} strokeWidth={isActive ? 2.25 : 1.85} />
              </span>
              <span className="bottom-nav__label">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
