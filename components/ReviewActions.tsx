// components/ReviewActions.tsx — approve / reject / publish, refusal-aware
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  jobId: string;
  status: string;
};

type PublishError = {
  code?: "SEO_FAIL" | "LANDING_FLAG" | "SLUG_DUP" | "NOT_APPROVED" | string;
  error?: string;
  detail?: unknown;
};

const CODE_HINT: Record<string, string> = {
  SEO_FAIL:
    "Fix the draft: regenerate to fix auto-check failures, or edit the draft, then retry publish.",
  LANDING_FLAG:
    "This keyword needs a landing page, not a blog post. Build the landing page in the SaaS, then clear the flag on this job.",
  SLUG_DUP:
    "Rename the slug in the review UI (slug editor arrives in the next batch), then retry publish.",
  NOT_APPROVED: "Approve the job first.",
};

export function ReviewActions({ jobId, status }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<PublishError | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);

  function resetMessages() {
    setSuccess(null);
    setRefusal(null);
    setGenericError(null);
  }

  async function act(kind: "approved" | "rejected" | "publish") {
    setBusy(kind);
    resetMessages();
    try {
      if (kind === "publish") {
        const r = await fetch(`/api/review/${jobId}/publish`, {
          method: "POST",
        });
        const data = (await r.json().catch(() => ({}))) as PublishError & {
          publishedUrl?: string;
        };

        if (r.ok) {
          setSuccess(`Published → ${data.publishedUrl}`);
        } else if (r.status === 422 || r.status === 409 || r.status === 400) {
          // Structured refusal from a gate
          setRefusal({
            code: data.code,
            error: data.error ?? `Refused (${r.status})`,
            detail: data.detail,
          });
        } else {
          setGenericError(data.error ?? `Publish failed (${r.status})`);
        }
        startTransition(() => router.refresh());
      } else {
        const r = await fetch(`/api/review/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: kind, reviewNotes: notes }),
        });
        if (!r.ok) {
          setGenericError(`Failed: ${r.status}`);
          return;
        }
        startTransition(() => router.refresh());
      }
    } catch (e) {
      setGenericError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Review notes (optional)"
      />

      <div className="flex flex-wrap gap-2">
        {status === "awaiting_review" && (
          <>
            <Button onClick={() => act("approved")} disabled={busy !== null}>
              {busy === "approved" ? "Approving…" : "Approve"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => act("rejected")}
              disabled={busy !== null}
            >
              {busy === "rejected" ? "Rejecting…" : "Reject"}
            </Button>
          </>
        )}
        {status === "approved" && (
          <Button onClick={() => act("publish")} disabled={busy !== null}>
            {busy === "publish" ? "Publishing…" : "Publish now"}
          </Button>
        )}
      </div>

      {/* Success */}
      {success && (
        <div className="rounded border border-green-500/40 bg-green-50 p-2 text-xs text-green-800">
          {success}
        </div>
      )}

      {/* Structured refusal */}
      {refusal && (
        <div className="rounded border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-900">
          <div className="font-medium">
            Refused{refusal.code ? ` · ${refusal.code}` : ""}
          </div>
          <p className="mt-1 break-all">{refusal.error}</p>
          {refusal.code && CODE_HINT[refusal.code] && (
            <p className="mt-1 text-amber-800">{CODE_HINT[refusal.code]}</p>
          )}
        </div>
      )}

      {/* Generic error */}
      {genericError && (
        <div className="rounded border border-red-500/40 bg-red-50 p-2 text-xs text-red-800 break-all">
          {genericError}
        </div>
      )}
    </div>
  );
}