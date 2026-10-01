"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { chatMessages, type ChatMessage } from "@/lib/chat";
import { record, text } from "@/lib/data";
import { timestampLabel } from "@/lib/dates";
import { copy } from "@/lib/i18n";
import { useTraining } from "./workspace";
import { Badge, Button, ErrorNotice, Mark, PageHeading, Skeleton } from "./ui";
import { DeletionConfirmations } from "./deletion-confirmations";
import { TelegramConnection } from "./telegram-connection";
type Attempt = { message: string; key: string };
export function Coach() {
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
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setHistoryError("");
    api("/api/chat", { signal: controller.signal })
      .then((result) => setMessages(chatMessages(result)))
      .catch((e) => {
        if (!controller.signal.aborted) setHistoryError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version]);
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
        body: { message: next.message },
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
        const history = await api("/api/chat");
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
        inputRef.current?.focus();
      }
    }
  }
  return (
    <>
      <PageHeading
        eyebrow={copy.coach.eyebrow}
        title={copy.coach.title}
        description={copy.coach.description}
        action={
          <Badge accent>
            <ShieldCheck size={11} aria-hidden="true" />
            {copy.coach.connected}
          </Badge>
        }
      />
      <TelegramConnection />
      <div className="chat-workspace">
        <div className="chat-topline">
          <div>
            <span className="coach-avatar">
              <Mark />
            </span>
            <span>
              <strong>{copy.coach.name}</strong>
              <small>{copy.brand}</small>
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={copy.coach.restore}
            disabled={busy}
            onClick={() => {
              setVersion((v) => v + 1);
              setConfirmVersion((v) => v + 1);
            }}
          >
            <RotateCcw size={15} aria-hidden="true" />
          </Button>
        </div>
        <div
          className="chat-history"
          tabIndex={0}
          role="log"
          aria-label={copy.coach.history}
          aria-live="polite"
          aria-relevant="additions text"
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
                <div className="message-avatar">
                  {message.role === "assistant" ? (
                    <Mark />
                  ) : (
                    <MessageCircle size={16} aria-hidden="true" />
                  )}
                </div>
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
                  <div className="message-text">{message.content}</div>
                </div>
              </article>
            ))
          ) : (
            <div className="chat-welcome">
              <div className="welcome-mark">
                <Mark />
              </div>
              <p className="eyebrow">{copy.brand}</p>
              <h2>{copy.coach.welcome}</h2>
              <p>{copy.coach.intro}</p>
              <div className="advice-chips">
                {copy.coach.chips.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => {
                      setInput(chip);
                      inputRef.current?.focus();
                    }}
                  >
                    {chip}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {busy && (
            <div className="thinking-state" role="status">
              <Mark className="loading-mark" />
              <div>
                <strong>{copy.coach.thinking}</strong>
                <span>{copy.coach.thinkingDetail}</span>
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>
        <div className="chat-bottom">
          <DeletionConfirmations version={confirmVersion} />
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
              aria-label={copy.coach.send}
              disabled={!input.trim() || busy || loading || !!historyError}
            >
              <ArrowUp size={17} aria-hidden="true" />
            </Button>
          </form>
          <p className="composer-footer">
            <ShieldCheck size={11} aria-hidden="true" />
            {copy.coach.footer}
          </p>
        </div>
      </div>
    </>
  );
}
