// components/KeywordTable.tsx — keyword pipeline table with cannibalization display
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KeywordEvidenceDialog } from "./KeywordEvidenceDialog";

type Keyword = {
  _id: string;
  keyword: string;
  source: string;
  status: string;
  decision: string;
  opportunityScore: number;
  demand: number;
  serpOpp: number;
  fit: number;
  overrideReason?: string;
  giantsInTop10: number;
  weakSitesInTop10: number;
  topResults: { title: string; domain: string }[];
  paas: string[];
  related: string[];
  gscImpressions: number;
  gscPosition: number;
  intent?: string | null;
  cannibalizedBy?: {
    url: string;
    slug: string;
    title: string;
    matchedKeyword: string;
    confidence: string;
  } | null;
  featuredSnippetType?: string | null;
};

export function KeywordTable({ keywords }: { keywords: Keyword[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/keywords/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        alert(`Failed: ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  if (keywords.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        No keywords yet. Run <code>keyword-harvest</code> to populate.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Keyword</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Decision</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keywords.map((k) => {
          const cannibalized =
            k.cannibalizedBy && k.cannibalizedBy.url
              ? k.cannibalizedBy
              : null;
          return (
            <TableRow key={k._id}>
              <TableCell className="max-w-xs">
                <div className="flex flex-col gap-1">
                  <div className="truncate font-medium">{k.keyword}</div>
                  {cannibalized && (
                    <a
                      href={cannibalized.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-xs text-amber-700 hover:underline"
                      title={`${cannibalized.confidence} match on "${cannibalized.matchedKeyword}"`}
                    >
                      ⟳ dup of: {cannibalized.title || cannibalized.slug}
                    </a>
                  )}
                  {k.featuredSnippetType && (
                    <Badge variant="outline" className="w-fit text-[10px]">
                      SERP: {k.featuredSnippetType}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <span className="font-mono">{k.opportunityScore}</span>
                  <span className="text-xs text-muted-foreground">
                    ({k.demand}+{k.serpOpp}+{k.fit})
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    k.decision === "TARGET"
                      ? "default"
                      : k.decision === "WATCH"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {k.decision}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {k.source}
              </TableCell>
              <TableCell className="text-xs">{k.status}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <KeywordEvidenceDialog keyword={k} />
                  {(k.status === "new" || k.status === "watch") && (
                    <Button
                      size="sm"
                      disabled={busy === k._id}
                      onClick={() => setStatus(k._id, "approved")}
                    >
                      Approve
                    </Button>
                  )}
                  {k.status !== "rejected" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === k._id}
                      onClick={() => setStatus(k._id, "rejected")}
                    >
                      Reject
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}