"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  jobId: string;
  initialUrl: string;
  initialTranscript: string;
  disabled?: boolean;
};

export function YouTubeContextInput({
  jobId,
  initialUrl,
  initialTranscript,
  disabled,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [url, setUrl] = useState(initialUrl);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const hasTranscript = transcript.trim().length >= 100;

  async function regenerate() {
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch(`/api/review/${jobId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: url.trim(),
          youtubeTranscript: transcript.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `Failed (${res.status})`);
        return;
      }
      setOk(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">YouTube context (optional)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Paste a YouTube URL and its transcript. When you regenerate, the AI
          treats the transcript as evidence and extracts 2 to 3 attributed
          quotes. Your slug is preserved.
        </p>
        <Input
          placeholder="https://youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled || busy}
        />
        <textarea
          placeholder="Paste transcript here. Anything under 100 chars is treated as empty."
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={8}
          disabled={disabled || busy}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {transcript.trim().length} chars
            {hasTranscript ? " (will use as RAG)" : " (transcript too short — will regenerate without it)"}
          </p>
          <Button
            onClick={regenerate}
            disabled={busy || disabled}
            variant={hasTranscript ? "default" : "outline"}
          >
            {busy
              ? "Regenerating (30 to 50 seconds)..."
              : hasTranscript
                ? "Regenerate with transcript"
                : "Regenerate (no transcript)"}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive break-all">{error}</p>}
        {ok && (
          <p className="text-xs text-green-600">
            Regenerated. The new draft is above; scroll to review.
          </p>
        )}
      </CardContent>
    </Card>
  );
}