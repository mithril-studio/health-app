"use client";
import "./page-menu.css";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The shell owns the full-width menu row; each page supplies its controls. */
export function PageMenu({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById("page-menu"));
  }, []);
  return host
    ? createPortal(<div className="page-menu-content">{children}</div>, host)
    : null;
}
export function PageTabs({
  prefix,
  label,
  tabs,
  value,
  onChange,
}: {
  prefix: string;
  label: string;
  tabs: readonly { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="section-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${prefix}-${tab.id}-tab`}
          aria-controls={`${prefix}-${tab.id}-panel`}
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft")
              next = (index - 1 + tabs.length) % tabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = tabs.length - 1;
            else return;
            event.preventDefault();
            onChange(tabs[next].id);
            document.getElementById(`${prefix}-${tabs[next].id}-tab`)?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
export function PagePanel({
  prefix,
  id,
  value,
  children,
}: {
  prefix: string;
  id: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <section
      role="tabpanel"
      id={`${prefix}-${id}-panel`}
      aria-labelledby={`${prefix}-${id}-tab`}
      hidden={value !== id}
      tabIndex={0}
    >
      {children}
    </section>
  );
}
