"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  ChartNoAxesCombined,
  MessageCircle,
  PanelLeft,
  PanelLeftClose,
  Sun,
  Moon,
  RefreshCw,
  LogOut,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { SourceNotice } from "./source-notice";
import { TelegramConnection } from "./telegram-connection";
import { copy } from "@/lib/i18n";
import { timestampLabel } from "@/lib/dates";
import { useTraining } from "./workspace";
import { Button, ErrorNotice, Mark, Modal, cn } from "./ui";
const nav = [
  { href: "/", key: "overview", Icon: LayoutDashboard },
  { href: "/coach", key: "coach", Icon: MessageCircle },
  { href: "/calendar", key: "calendar", Icon: CalendarDays },
  { href: "/insights", key: "insights", Icon: ChartNoAxesCombined },
] as const;
function preference(name: string, value: string) {
  document.cookie = `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
  try {
    localStorage.setItem(name, value);
  } catch {
    /* Cookie remains the source for server rendering. */
  }
}
export function Shell({
  children,
  theme: initialTheme,
  sidebarOpen,
  onLogout,
}: {
  children: React.ReactNode;
  theme: "light" | "dark";
  sidebarOpen: boolean;
  onLogout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(sidebarOpen);
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState(() =>
    typeof document === "undefined"
      ? initialTheme
      : document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
  );
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const { data, error, syncing, loading, refresh } = useTraining();
  const title = nav.find((item) => item.href === pathname)?.key ?? "overview";
  useEffect(() => {
    setMobile(false);
  }, [pathname]);
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    preference("theme", next);
  };
  const navigation = (
    <>
      <Link href="/" className="brand" onClick={() => setMobile(false)}>
        <Mark />
        <span>{copy.brand}</span>
      </Link>
      <div className="workspace-label">{copy.common.workspace}</div>
      <nav aria-label={copy.common.navigation}>
        {nav.map(({ href, key, Icon }) => (
          <Link
            key={key}
            href={href}
            className={cn("nav-item", pathname === href && "active")}
            aria-current={pathname === href ? "page" : undefined}
            onClick={() => setMobile(false)}
          >
            <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>{copy.nav[key]}</span>
            {pathname === href && <span className="nav-dot" />}
          </Link>
        ))}
      </nav>
      <div className="sidebar-goal">
        <div className="goal-heading">
          <span>{copy.overview.goalTitle}</span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </div>
        <div className="sidebar-goal-number">
          5<span>{copy.common.km}</span>
        </div>
        <div className="sidebar-milestones">
          <span>{copy.insights.sub18}</span>
          <span className="milestone-line" />
          <span>{copy.insights.sub17}</span>
        </div>
        <p>{copy.tagline}</p>
      </div>
      <div className="sidebar-bottom">
        <div className="privacy-label">
          <ShieldCheck size={14} aria-hidden="true" />
          {copy.common.privacy}
        </div>
        <div className="profile">
          <div className="avatar">
            <Mark />
          </div>
          <div>
            <strong>{copy.common.athlete}</strong>
            <span>{copy.common.personal}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={copy.common.logout}
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              try {
                await onLogout();
              } catch {
                setLogoutError(copy.common.logoutError);
              } finally {
                setLoggingOut(false);
              }
            }}
          >
            <LogOut size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </>
  );
  const last = data?.sync.lastSuccess;
  const stamp = last ? timestampLabel(last) : null;
  const stale = last
    ? !Number.isFinite(Date.parse(last)) ||
      Date.now() - Date.parse(last) > 6 * 3600000
    : true;
  const syncLabel = data?.sync.error
    ? copy.sync.failed
    : !stamp
      ? copy.sync.never
      : stale
        ? copy.sync.stale
        : copy.sync.fresh;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {copy.common.skip}
      </a>
      <aside
        className={cn("sidebar", !open && "collapsed")}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="sidebar-inner">{navigation}</div>
      </aside>
      <Modal
        open={mobile}
        onClose={() => setMobile(false)}
        title={copy.brand}
        description={copy.common.navigation}
      >
        <div className="mobile-navigation">{navigation}</div>
      </Modal>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <Button
              className="desktop-toggle"
              variant="ghost"
              size="icon"
              aria-label={open ? copy.common.collapse : copy.common.expand}
              aria-expanded={open}
              onClick={() => {
                setOpen(!open);
                preference("sidebar_state", open ? "0" : "1");
              }}
            >
              {open ? (
                <PanelLeftClose size={18} aria-hidden="true" />
              ) : (
                <PanelLeft size={18} aria-hidden="true" />
              )}
            </Button>
            <Button
              className="mobile-toggle"
              variant="ghost"
              size="icon"
              aria-label={copy.common.expand}
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <PanelLeft size={18} aria-hidden="true" />
            </Button>
            <span className="breadcrumb">{copy.common.athlete}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{copy.nav[title]}</strong>
          </div>
          <div className="topbar-actions">
            <TelegramConnection />
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                theme === "light" ? copy.common.dark : copy.common.light
              }
              onClick={toggleTheme}
            >
              {theme === "light" ? (
                <Moon size={17} aria-hidden="true" />
              ) : (
                <Sun size={17} aria-hidden="true" />
              )}
            </Button>
          </div>
        </header>
        <div className="main-scroll">
          <main id="main-content" tabIndex={-1} className="page-content">
            <div className="sync-toolbar">
              <span
                className="sync-status"
                title={stamp ? `${copy.sync.last}: ${stamp}` : copy.sync.never}
              >
                <span
                  className={cn(
                    "status-dot",
                    !stale && !data?.sync.error && "fresh",
                  )}
                />
                {syncLabel}
                {stamp && <span className="sync-time">{stamp}</span>}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refresh(true)}
                disabled={syncing || loading}
              >
                <RefreshCw
                  size={13}
                  className={cn(syncing && "spin")}
                  aria-hidden="true"
                />
                {syncing ? copy.common.refreshing : copy.common.refresh}
              </Button>
            </div>
            {logoutError && <ErrorNotice message={logoutError} />}
            {error && data && (
              <ErrorNotice
                message={`${error} ${copy.sync.cached}`}
                retry={() => void refresh()}
              />
            )}
            {data?.sync.error && (
              <ErrorNotice
                message={`${copy.sync.failed}. ${copy.sync.cached}`}
                retry={() => void refresh(true)}
              />
            )}
            {data && <SourceNotice data={data} />}
            {children}
            <footer className="page-footer">
              <span>
                <Mark />
                {copy.brand}
              </span>
              <span>
                {copy.common.basedOn}
                <span className="footer-dot">·</span>
                {copy.common.privacy}
              </span>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
