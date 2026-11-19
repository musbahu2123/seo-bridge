// components/RefreshStyleButton.tsx — on-demand style-learn trigger
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  siteId: string;
  hasProfile: boolean;
};

export function RefreshStyleButton({ siteId, hasProfile }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/jobs/style-learn?site=${siteId}`, {
        method: "POST",
      });
      const data = (await r.json().catch(() => ({}))) as {
        error?: string;
        version?: number | null;
        learnedFrom?: number;
        sites?: Array<{ error?: string }>;
      };

      if (!r.ok) {
        setMsg(`Failed: ${data.error ?? r.status}`);
        return;
      }

      const siteResult = data.sites?.[0];
      if (siteResult?.error) {
        setMsg(`Failed: ${siteResult.error.slice(0, 120)}`);
        return;
      }

      setMsg(
        `Learned v${data.version ?? "?"} from ${data.learnedFrom ?? 0} posts`,
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant={hasProfile ? "ghost" : "default"}
        onClick={run}
        disabled={busy}
      >
        {busy ? "Learning…" : hasProfile ? "Refresh style" : "Learn style"}
      </Button>
      {msg && (
        <p className="text-xs text-muted-foreground break-all max-w-[220px]">
          {msg}
        </p>
      )}
    </div>
  );
}