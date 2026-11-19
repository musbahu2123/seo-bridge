"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PLAYS = [
  "directory", "listicle-outreach", "listicle-tombstone", "gift-correction",
  "gift-reshoot", "gift-diagram", "reclaim-broken", "reclaim-mention",
  "reclaim-customer-story", "forum", "exchange", "ai-citation",
];

const PAGE_TYPES = ["listicle", "tutorial", "stats", "guide", "directory", "forum", "n/a"];

export function LinkTaskForm({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    play: "directory",
    targetDomain: "",
    targetUrl: "",
    pageType: "n/a",
    dr: "",
    contact: "",
    notes: "",
  });

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        site: siteId,
        play: form.play,
        targetDomain: form.targetDomain.trim(),
        targetUrl: form.targetUrl.trim(),
        pageType: form.pageType,
        contact: form.contact.trim(),
        notes: form.notes.trim(),
      };
      if (form.dr.trim()) payload.dr = Number(form.dr);
      const r = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? `Failed ${r.status}`); return; }
      setForm({ play: "directory", targetDomain: "", targetUrl: "", pageType: "n/a", dr: "", contact: "", notes: "" });
      startTransition(() => router.refresh());
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Select value={form.play} onValueChange={(v) => update("play", v)}>
          <SelectTrigger><SelectValue placeholder="Play" /></SelectTrigger>
          <SelectContent>{PLAYS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="targetDomain (e.g. g2.com)" value={form.targetDomain} onChange={(e) => update("targetDomain", e.target.value)} required />
        <Input placeholder="targetUrl (optional)" value={form.targetUrl} onChange={(e) => update("targetUrl", e.target.value)} />
        <Select value={form.pageType} onValueChange={(v) => update("pageType", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PAGE_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="DR (blank = unknown)" value={form.dr} onChange={(e) => update("dr", e.target.value)} />
        <Input placeholder="contact (email/name)" value={form.contact} onChange={(e) => update("contact", e.target.value)} />
        <Input placeholder="notes" value={form.notes} onChange={(e) => update("notes", e.target.value)} className="sm:col-span-2" />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add prospect"}</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}