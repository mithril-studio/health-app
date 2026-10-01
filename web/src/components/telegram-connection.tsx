"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, Send } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { record } from "@/lib/data";
import { pairingURL, telegramCopy as t } from "@/lib/telegram";
import { Badge, Button, Modal, ErrorNotice, buttonStyle } from "./ui";

export function TelegramConnection() {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const check = useCallback(async () => {
    try {
      const status = record(await api("/api/telegram"));
      setConnected(status.connected === true);
      if (status.connected === true) setLink("");
      setError("");
    } catch {
      setError(t.failed);
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  useEffect(() => {
    if (!link) return;
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, 15000);
    const expiry = window.setTimeout(() => setLink(""), 600000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
      clearTimeout(expiry);
    };
  }, [link, check]);
  async function pair() {
    setBusy(true);
    setError("");
    try {
      const result = record(
        await api("/api/telegram/pairing", { method: "POST" }),
      );
      setLink(pairingURL(result.url));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a
        className={buttonStyle({
          variant: "ghost",
          className: "telegram-topbar",
        })}
        href="https://t.me/coachreachybot"
        target="_blank"
        rel="noopener noreferrer"
        aria-haspopup={connected ? undefined : "dialog"}
        onClick={(event) => {
          if (connected !== true) {
            event.preventDefault();
            setOpen(true);
            void check();
          }
        }}
      >
        <Send size={16} aria-hidden="true" />
        {t.nav}
      </a>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t.title}
        description={t.detail}
      >
        <div className="card-heading">
          <div>
            {connected ? (
              <Badge accent>
                <CheckCircle2 size={12} aria-hidden="true" />
                {t.connected}
              </Badge>
            ) : (
              <p>{connected === null ? t.checking : t.disconnected}</p>
            )}
            {link && (
              <>
                <p>{t.instruction}</p>
                <a
                  className={buttonStyle({ variant: "default" })}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.open}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </>
            )}
          </div>
          <Button variant="outline" onClick={() => void pair()} disabled={busy}>
            {busy ? t.connecting : connected ? t.reconnect : t.connect}
          </Button>
        </div>
        {error && <ErrorNotice message={error} retry={() => void check()} />}
        {link && (
          <div className="card-footer">
            <Button variant="ghost" size="sm" onClick={() => void check()}>
              {t.refresh}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
