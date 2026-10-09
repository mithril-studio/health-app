"use client";
import { useState } from "react";
import { athleteCopy as c } from "@/lib/athlete-copy";
import { Button, Modal } from "./ui";
import { RecordDraft } from "./record-draft";
export function CoachFollowUp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {c.followUp}
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={c.followUp}
        description={c.draftNote}
      >
        <RecordDraft initialText={text} onPendingChange={setPending} />
      </Modal>
    </>
  );
}
