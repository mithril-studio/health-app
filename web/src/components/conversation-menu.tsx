"use client";
import "./conversation-menu.css";
import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle, Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { record, text } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { Button, ErrorNotice, cn } from "./ui";
import { PageMenu } from "./page-menu";

type Conversation = { id: string; title: string };
function conversation(value: unknown): Conversation {
  const row = record(value),
    id = text(row.id);
  if (!/^(web|web:[a-f0-9]{32})$/.test(id))
    throw new Error("Invalid conversation");
  return { id, title: text(row.title) };
}
export function ConversationMenu({
  active,
  onSelect,
  busy,
  version,
}: {
  active: string;
  onSelect: (id: string) => void;
  busy: boolean;
  version: number;
}) {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api("/api/conversations", { signal: controller.signal })
      .then((result) => {
        const items = record(result).conversations;
        if (!Array.isArray(items)) throw new Error("Invalid conversation list");
        if (!controller.signal.aborted) setRows(items.map(conversation));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(copy.coach.historyUnavailable);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, version, retry]);
  async function create() {
    if (creating || busy) return;
    setCreating(true);
    setError("");
    try {
      const row = conversation(
        await api("/api/conversations", { method: "POST", body: {} }),
      );
      setRows((previous) => [row, ...previous]);
      setExpanded(false);
      onSelect(row.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }
  return (
    <aside
      className={cn("conversation-menu", expanded && "expanded")}
      aria-label={copy.coach.conversations}
    >
      <PageMenu>
        <div className="conversation-actions">
          <Button
            variant="ghost"
            className="conversation-history-toggle"
            aria-label={
              expanded ? copy.coach.hideHistory : copy.coach.showHistory
            }
            aria-expanded={expanded}
            aria-controls="conversation-list"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronDown size={16} aria-hidden="true" />
            {copy.coach.conversations}
          </Button>
          <Button
            variant="outline"
            disabled={busy || creating}
            onClick={() => void create()}
          >
            <Plus size={16} aria-hidden="true" />
            {copy.coach.newChat}
          </Button>
        </div>
      </PageMenu>
      <div id="conversation-list" className="conversation-list">
        {error && (
          <ErrorNotice message={error} retry={() => setRetry((v) => v + 1)} />
        )}
        {loading && !rows.length ? (
          <div className="history-loading" role="status">
            {copy.coach.loadingHistory}
          </div>
        ) : null}
        <nav aria-label={copy.coach.conversations}>
          {rows.map((row) => {
            const title =
              row.title ||
              (row.id === "web" ? copy.coach.earlierChats : copy.coach.newChat);
            return (
              <button
                key={row.id}
                title={title}
                className={cn(
                  "conversation-item",
                  active === row.id && "active",
                )}
                aria-current={active === row.id ? "page" : undefined}
                disabled={busy || creating}
                onClick={() => {
                  setExpanded(false);
                  onSelect(row.id);
                }}
              >
                <MessageCircle size={15} aria-hidden="true" />
                <span>{title}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
