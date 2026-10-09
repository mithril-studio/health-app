"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  FileText,
  MoonStar,
  RotateCcw,
  Sunrise,
  type LucideIcon,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { timestampLabel } from "@/lib/dates";
import { copy } from "@/lib/i18n";
import { parseReports, type Report, type ReportKind } from "@/lib/reports";
import { Button, ErrorNotice, Mark, Skeleton } from "./ui";
import { ChatMarkdown } from "./chat-markdown";
const kindIcon: Record<ReportKind, LucideIcon> = {
  morning: Sunrise,
  evening: MoonStar,
  activity: Activity,
  report: FileText,
};
export function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api("/api/reports", { signal: controller.signal })
      .then((result) => setReports(parseReports(result)))
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version]);
  return (
    <div className="chat-workspace">
      <div className="chat-topline">
        <div>
          <span className="coach-avatar">
            <Mark />
          </span>
          <span>
            <strong>{copy.reports.title}</strong>
            <small>{copy.reports.subtitle}</small>
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copy.reports.refresh}
          disabled={loading}
          onClick={reload}
        >
          <RotateCcw size={15} aria-hidden="true" />
        </Button>
      </div>
      <div
        className="chat-history"
        tabIndex={0}
        role="log"
        aria-label={copy.reports.history}
        aria-live="polite"
      >
        {loading ? (
          <Skeleton compact />
        ) : error ? (
          <ErrorNotice message={error} retry={reload} />
        ) : reports.length ? (
          reports.map((report) => {
            const Icon = kindIcon[report.kind];
            const time = timestampLabel(report.createdAt);
            return (
              <article key={report.id} className="chat-message assistant">
                <div className="message-avatar">
                  <Icon size={16} aria-hidden="true" />
                </div>
                <div className="message-content">
                  <div className="message-meta">
                    <strong>{copy.reports.kinds[report.kind]}</strong>
                    {time && <time dateTime={report.createdAt}>{time}</time>}
                  </div>
                  <div className="message-text">
                    <ChatMarkdown content={report.content} />
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="chat-welcome">
            <div className="welcome-mark">
              <Mark />
            </div>
            <h2>{copy.reports.title}</h2>
            <p>{copy.reports.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}
