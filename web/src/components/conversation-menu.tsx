"use client";
import "./conversation-menu.css";
import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Clock, FileText, MessageCircle, Search } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { record, text } from "@/lib/data";
import { dayStampLabel } from "@/lib/dates";
import { copy } from "@/lib/i18n";
import { REPORTS } from "@/lib/reports";
import { Button, ErrorNotice, cn } from "./ui";

export type Conversation = { id: string; title: string; updatedAt: string };
function conversation(value: unknown): Conversation {
  const row = record(value),
    id = text(row.id);
  if (!/^(web|web:[a-f0-9]{32})$/.test(id))
    throw new Error("Invalid conversation");
  return { id, title: text(row.title), updatedAt: text(row.updated_at) };
}
export function conversationTitle(row: Conversation) {
  return (
    row.title ||
    (row.id === "web" ? copy.coach.earlierChats : copy.coach.newChat)
  );
}
export function useConversations({
  busy,
  version,
  onLoaded,
}: {
  busy: boolean;
  version: number;
  /** Called after each list load with the most recent conversation id, or null when the list is empty or failed. */
  onLoaded?: (first: string | null) => void;
}) {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api("/api/conversations", { signal: controller.signal })
      .then((result) => {
        const items = record(result).conversations;
        if (!Array.isArray(items)) throw new Error("Invalid conversation list");
        if (controller.signal.aborted) return;
        const next = items.map(conversation);
        setRows(next);
        onLoaded?.(next[0]?.id ?? null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError(copy.coach.historyUnavailable);
        onLoaded?.(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The list only changes when history changes (version) or on retry;
    // switching the active conversation does not need a reload.
  }, [version, attempt, onLoaded]);
  const retry = useCallback(() => setAttempt((v) => v + 1), []);
  /** Starts a conversation and resolves to its id, or null when it couldn't be created. */
  async function create(): Promise<string | null> {
    if (creating || busy) return null;
    setCreating(true);
    setError("");
    try {
      const row = conversation(
        await api("/api/conversations", { method: "POST", body: {} }),
      );
      setRows((previous) => [row, ...previous]);
      return row.id;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setCreating(false);
    }
  }
  return { rows, loading, error, retry, creating, create };
}
/** The History button and its dropdown: Reports, then searchable conversations. */
export function ConversationHistory({
  open,
  onOpenChange,
  rows,
  loading,
  error,
  retry,
  active,
  busy,
  creating,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Conversation[];
  loading: boolean;
  error: string;
  retry: () => void;
  active: string;
  busy: boolean;
  creating: boolean;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? rows.filter((row) =>
        conversationTitle(row).toLowerCase().includes(needle),
      )
    : rows;
  function toggle(next: boolean) {
    onOpenChange(next);
    if (!next) setQuery("");
  }
  function select(id: string) {
    onSelect(id);
    toggle(false);
  }
  return (
    <Dialog.Root open={open} onOpenChange={toggle} modal={false}>
      <div className="history-anchor">
        <Dialog.Trigger asChild>
          <Button
            variant="ghost"
            className={cn(open && "active")}
            aria-label={copy.coach.historyButton}
          >
            <Clock size={16} aria-hidden="true" />
            <span className="page-action-label">
              {copy.coach.historyButton}
            </span>
          </Button>
        </Dialog.Trigger>
        <Dialog.Content
          className="history-dropdown"
          aria-describedby={undefined}
        >
          <Dialog.Title className="history-title">
            {copy.coach.historyButton}
          </Dialog.Title>
          <label className="history-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">{copy.coach.searchHistory}</span>
            <input
              type="search"
              placeholder={copy.coach.searchHistory}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="conversation-pinned">
            <button
              type="button"
              title={copy.reports.nav}
              className={cn(
                "conversation-item",
                active === REPORTS && "active",
              )}
              aria-current={active === REPORTS ? "page" : undefined}
              onClick={() => select(REPORTS)}
            >
              <FileText size={15} aria-hidden="true" />
              <span>{copy.reports.nav}</span>
            </button>
          </div>
          {error && <ErrorNotice message={error} retry={retry} />}
          {loading && !rows.length ? (
            <div className="history-loading" role="status">
              {copy.coach.loadingHistory}
            </div>
          ) : needle && !matches.length ? (
            <div className="history-loading" role="status">
              {copy.coach.noMatches}
            </div>
          ) : null}
          <nav aria-label={copy.coach.conversations}>
            {matches.map((row) => {
              const title = conversationTitle(row);
              const day = row.updatedAt && dayStampLabel(row.updatedAt);
              return (
                <button
                  key={row.id}
                  type="button"
                  title={title}
                  className={cn(
                    "conversation-item",
                    active === row.id && "active",
                  )}
                  aria-current={active === row.id ? "page" : undefined}
                  disabled={busy || creating}
                  onClick={() => select(row.id)}
                >
                  <MessageCircle size={14} aria-hidden="true" />
                  <span>{title}</span>
                  {day && <time dateTime={row.updatedAt}>{day}</time>}
                </button>
              );
            })}
          </nav>
        </Dialog.Content>
      </div>
    </Dialog.Root>
  );
}
