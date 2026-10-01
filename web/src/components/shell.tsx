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
    /* Cookie seeds SSR. */
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
      <div className="sidebar-heading">
        <Link
          href="/"
          className="brand"
          aria-label={copy.brand}
          onClick={() => setMobile(false)}
        >
          <Mark />
          <span>{copy.brand}</span>
        </Link>
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
      </div>
      <nav aria-label={copy.common.navigation}>
        {nav.map(({ href, key, Icon }) => (
          <Link
            key={key}
            href={href}
            title={copy.nav[key]}
            aria-label={copy.nav[key]}
            className={cn("nav-item", pathname === href && "active")}
            aria-current={pathname === href ? "page" : undefined}
            onClick={() => setMobile(false)}
          >
            <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
            <span className="nav-label">{copy.nav[key]}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Button
          variant="ghost"
          className="sidebar-action"
          aria-label={theme === "light" ? copy.common.dark : copy.common.light}
          title={theme === "light" ? copy.common.dark : copy.common.light}
          onClick={toggleTheme}
        >
          {theme === "light" ? (
            <Moon size={17} aria-hidden="true" />
          ) : (
            <Sun size={17} aria-hidden="true" />
          )}
          <span className="nav-label">
            {theme === "light" ? copy.common.dark : copy.common.light}
          </span>
        </Button>
        <Button
          variant="ghost"
          className="sidebar-action"
          aria-label={copy.common.logout}
          title={copy.common.logout}
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
          <LogOut size={17} aria-hidden="true" />
          <span className="nav-label">{copy.common.logout}</span>
        </Button>
      </div>
    </>
  );
  const stamp = data?.sync.lastSuccess
    ? timestampLabel(data.sync.lastSuccess)
    : null;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {copy.common.skip}
      </a>
      <aside className={cn("sidebar", !open && "collapsed")}>
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
              className="mobile-toggle"
              variant="ghost"
              size="icon"
              aria-label={copy.common.expand}
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <PanelLeft size={18} aria-hidden="true" />
            </Button>
            <strong>{copy.nav[title]}</strong>
          </div>
          <div className="topbar-actions">
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                syncing ? copy.common.refreshing : copy.common.refresh
              }
              title={stamp ? `${copy.sync.last}: ${stamp}` : copy.sync.never}
              disabled={syncing || loading}
              onClick={() => void refresh(true)}
            >
              <RefreshCw
                size={16}
                className={cn(syncing && "spin")}
                aria-hidden="true"
              />
            </Button>
            <TelegramConnection />
          </div>
        </header>
        <div className="main-scroll">
          <main
            id="main-content"
            tabIndex={-1}
            className={cn(
              "page-content",
              pathname === "/coach" && "coach-page",
            )}
          >
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
            {data && pathname !== "/coach" && <SourceNotice data={data} />}
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
