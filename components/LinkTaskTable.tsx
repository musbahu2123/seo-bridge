"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Link = {
  _id: string;
  play: string;
  targetDomain: string;
  targetUrl: string;
  pageType: string;
  dr: number | null;
  status: string;
  contact: string;
  placedUrl: string;
  judgeAfter: string | null;
  placedAt: string | null;
};

const STATUSES = ["prospect", "drafted", "sent", "replied", "placed", "rejected"];

export function LinkTaskTable({ links }: { links: Link[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/links/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) { alert(`Failed ${r.status}`); return; }
      startTransition(() => router.refresh());
    } finally { setBusy(null); }
  }

  if (links.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No link prospects yet.</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Play</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>DR</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Judge after</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((l) => (
          <TableRow key={l._id}>
            <TableCell className="font-medium">{l.targetDomain}</TableCell>
            <TableCell className="text-xs">{l.play}</TableCell>
            <TableCell className="text-xs">{l.pageType}</TableCell>
            <TableCell className="text-xs">{l.dr ?? "—"}</TableCell>
            <TableCell>
              <Select value={l.status} onValueChange={(v) => setStatus(l._id, v)} disabled={busy === l._id}>
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {l.judgeAfter ? new Date(l.judgeAfter).toISOString().slice(0, 10) : "—"}
            </TableCell>
            <TableCell className="text-right">
              {l.targetUrl && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={l.targetUrl} target="_blank" rel="noreferrer">Open</a>
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}