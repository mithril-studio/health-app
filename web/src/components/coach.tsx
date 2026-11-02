"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConversationHistory, useConversations } from "./conversation-menu";
import { ArrowUp, Plus, RotateCcw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { chatMessages, type ChatMessage } from "@/lib/chat";
import { record, text } from "@/lib/data";
import { timestampLabel } from "@/lib/dates";
import { copy } from "@/lib/i18n";
import { REPORTS } from "@/lib/reports";
import { useTraining } from "./workspace";
import { Button, ErrorNotice, Skeleton, Spinner, cn } from "./ui";
import { DeletionConfirmations } from "./deletion-confirmations";
import { ChatMarkdown } from "./chat-markdown";
import { PageActions } from "./page-menu";
import { Reports } from "./reports";
type Attempt = { message: string; key: string };
export function Coach() {
  const router = useRouter();
  const requested = useSearchParams().get("chat");
  // Without an explicit ?chat=, open the most recently updated conversation
  // (the first row of the list) rather than the legacy "web" thread.
  const [latest, setLatest] = useState<string | null>(null);
  const conversationId = requested || latest;
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  // The shell's sync button also reloads the open thread or reports once a
  // sync finishes, unless a reply is still in flight.
  const { syncing } = useTraining();
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !syncing && !busy) setReload((v) => v + 1);
    wasSyncing.current = syncing;
  }, [syncing, busy]);
  const loaded = useCallback(
    (first: string | null) => setLatest(first ?? "web"),
    [],
  );
  const list = useConversations({ busy, version, onLoaded: loaded });
  const open = (id: string) =>
    router.push(`/coach?chat=${encodeURIComponent(id)}`, { scroll: false });
  return (
    <>
      <PageActions>
        <Button
          variant="ghost"
          aria-label={copy.coach.newChat}
          disabled={busy || list.creating}
          onClick={async () => {
            const id = await list.create();
            if (id) open(id);
          }}
        >
          <Plus size={16} aria-hidden="true" />
          <span className="page-action-label">{copy.coach.newChat}</span>
        </Button>
        <ConversationHistory
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          rows={list.rows}
          loading={list.loading}
          error={list.error}
          retry={list.retry}
          active={conversationId ?? ""}
          busy={busy}
          creating={list.creating}
          onSelect={open}
        />
      </PageActions>
      <div className="coach-layout">
        {list.error && !historyOpen && (
          <div className="coach-notice">
            <ErrorNotice message={list.error} retry={list.retry} />
          </div>
        )}
        {conversationId === null ? (
          <div className="chat-workspace" aria-busy="true">
            <div className="chat-history">
              <div className="chat-column">
                <Skeleton compact />
              </div>
            </div>
          </div>
        ) : conversationId === REPORTS ? (
          <Reports reloadKey={reload} />
        ) : (
          <Conversation
            key={conversationId}
            conversationId={conversationId}
            reloadKey={reload}
            onBusyChange={setBusy}
            onHistoryChange={changed}
          />
        )}
      </div>
    </>
  );
}
function Conversation({
  conversationId,
  reloadKey,
  onBusyChange,
  onHistoryChange,
}: {
  conversationId: string;
  /** Bumped after a manual sync to refetch the thread and confirmations. */
  reloadKey: number;
  onBusyChange: (busy: boolean) => void;
  onHistoryChange: () => void;
}) {
  const historyPath =
    conversationId === "web"
      ? "/api/chat"
      : `/api/chat?conversation_id=${encodeURIComponent(conversationId)}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [version, setVersion] = useState(0);
  const [confirmVersion, setConfirmVersion] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const { refresh } = useTraining();
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setHistoryError("");
    api(historyPath, { signal: controller.signal })
      .then((result) => setMessages(chatMessages(result)))
      .catch((e) => {
        if (!controller.signal.aborted) setHistoryError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version, historyPath, reloadKey]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [messages, busy]);
  async function send(retry?: Attempt) {
    if (busy || loading || historyError) return;
    const next = retry ?? { message: input.trim(), key: crypto.randomUUID() };
    if (!next.message) return;
    setBusy(true);
    setError("");
    setAttempt(next);
    setInput("");
    if (!retry)
      setMessages((rows) => [
        ...rows,
        {
          role: "user",
          content: next.message,
          createdAt: new Date().toISOString(),
        },
      ]);
    try {
      const result = await api("/api/chat", {
        method: "POST",
        body: { message: next.message, conversation_id: conversationId },
        idempotencyKey: next.key,
        timeout: 180000,
      });
      const reply = text(record(result).reply);
      if (!reply) throw new Error("Missing reply");
      if (!mounted.current) return;
      setMessages((rows) => [
        ...rows,
        {
          role: "assistant",
          content: reply,
          createdAt: new Date().toISOString(),
        },
      ]);
      setAttempt(null);
      setConfirmVersion((v) => v + 1);
      // Reconcile with persisted history without turning a successful reply into a failed send.
      try {
        const history = await api(historyPath);
        if (mounted.current) setMessages(chatMessages(history));
      } catch {
        /* The confirmed reply stays visible; reload remains available. */
      }
      void refresh();
    } catch (e) {
      if (mounted.current) {
        setError(errorMessage(e));
        setConfirmVersion((v) => v + 1);
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        onHistoryChange();
        inputRef.current?.focus();
      }
    }
  }
  return (
    <>
      <div className="chat-workspace">
        <div
          className="chat-history"
          tabIndex={0}
          role="log"
          aria-label={copy.coach.history}
          aria-live="polite"
          aria-relevant="additions text"
        >
          <div
            className={cn(
              "chat-column",
              !loading && !historyError && !messages.length && "chat-empty",
            )}
          >
            {loading ? (
              <Skeleton compact />
            ) : historyError ? (
              <ErrorNotice
                message={historyError}
                retry={() => setVersion((v) => v + 1)}
              />
            ) : messages.length ? (
              messages.map((message, i) => (
                <article
                  key={`${i}-${message.createdAt}`}
                  className={`chat-message ${message.role}`}
                >
                  <div className="message-content">
                    <div className="message-meta">
                      <strong>
                        {message.role === "assistant"
                          ? copy.coach.name
                          : copy.coach.you}
                      </strong>
                      {message.createdAt && (
                        <time dateTime={message.createdAt}>
                          {timestampLabel(message.createdAt)}
                        </time>
                      )}
                    </div>
                    <div className="message-text">
                      {message.role === "assistant" ? (
                        <ChatMarkdown content={message.content} />
                      ) : (
                        message.content
                      )}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="chat-welcome">
                <h2>{copy.coach.welcome}</h2>
                <p>{copy.coach.intro}</p>
                <div className="advice-chips">
                  {copy.coach.chips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setInput(chip);
                        inputRef.current?.focus();
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {busy && (
              <div className="thinking-state" role="status">
                <Spinner className="thinking-spinner" />
                <div>
                  <strong>{copy.coach.thinking}</strong>
                </div>
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>
        <div className="chat-bottom">
          <div className="chat-column">
            <DeletionConfirmations version={confirmVersion + reloadKey} />
            {error && (
              <div className="chat-error">
                <ErrorNotice message={error} />
                <p>{copy.coach.retryNote}</p>
                {attempt && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void send(attempt)}
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                    {copy.coach.retry}
                  </Button>
                )}
              </div>
            )}
            <form
              className="chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="coach-message">
                {copy.coach.input}
              </label>
              <textarea
                id="coach-message"
                ref={inputRef}
                placeholder={copy.coach.placeholder}
                value={input}
                maxLength={8000}
                rows={2}
                disabled={busy || loading || !!historyError}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                className="chat-send"
                aria-label={copy.coach.send}
                disabled={!input.trim() || busy || loading || !!historyError}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
