"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError, textareaClass } from "@/components/ui/field";
import { MAX_REPORT_LENGTH } from "./types";

// Party report on an Incomplete errand. One per party, immutable, closed once settlement starts.
export function ReportButton({ errandId }: { errandId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [filed, setFiled] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setPending(true);
    const res = await api("POST", `/api/errands/${errandId}/report`, { body: { text: text.trim() } });
    setPending(false);
    setOpen(false);
    if (res.ok) {
      setFiled(true);
      setError("");
      toast.success("Report sent", { description: "The admin will read it before settling." });
    } else {
      // ALREADY_REPORTED: an earlier visit filed one, and the backend has no route to read it back.
      if (res.code === "ALREADY_REPORTED") setFiled(true);
      setError(errorText(res, "Could not send your report."));
    }
  }

  return (
    <div className="space-y-2">
      {filed ? (
        <p className="text-center text-[13px] text-muted">Your report is filed. An admin will settle this errand.</p>
      ) : (
        <Button size="lg" block intent="outline" onClick={() => setOpen(true)}>
          Tell the admin what happened
        </Button>
      )}
      {error && <FormError>{error}</FormError>}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Report to the admin"
        description="You can send one report and cannot edit it. The other side can't read it."
        confirmLabel="Send"
        pending={pending}
        confirmDisabled={text.trim() === ""}
        onConfirm={() => void send()}
      >
        <textarea
          autoFocus
          rows={5}
          maxLength={MAX_REPORT_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What happened?"
          aria-label="Report"
          className={`w-full ${textareaClass}`}
        />
        <p className="mt-1 text-xs text-muted">
          {text.length}/{MAX_REPORT_LENGTH}
        </p>
      </ConfirmDialog>
    </div>
  );
}
