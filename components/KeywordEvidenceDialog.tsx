"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  keyword: {
    keyword: string;
    opportunityScore: number;
    demand: number;
    serpOpp: number;
    fit: number;
    decision: string;
    overrideReason?: string;
    giantsInTop10: number;
    weakSitesInTop10: number;
    topResults: { title: string; domain: string }[];
    paas: string[];
    related: string[];
    gscImpressions: number;
    gscPosition: number;
    source: string;
    intent?: string | null;
  };
};

export function KeywordEvidenceDialog({ keyword }: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Evidence
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words">{keyword.keyword}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant={keyword.decision === "TARGET" ? "default" : "secondary"}>
              {keyword.decision}
            </Badge>
            <Badge variant="outline">Score {keyword.opportunityScore}/10</Badge>
            <Badge variant="outline">Source: {keyword.source}</Badge>
            {keyword.intent && <Badge variant="outline">{keyword.intent}</Badge>}
          </div>

          {keyword.overrideReason && (
            <div className="rounded border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-800">
              {keyword.overrideReason}
            </div>
          )}

          <Section title="Score breakdown">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <KV k="Demand" v={`${keyword.demand}/3`} />
              <KV k="SERP Opp" v={`${keyword.serpOpp}/4`} />
              <KV k="Fit" v={`${keyword.fit}/3`} />
            </div>
          </Section>

          <Section title="SERP signals">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <KV k="Giants" v={keyword.giantsInTop10} />
              <KV k="Weak sites" v={keyword.weakSitesInTop10} />
              <KV k="GSC imp." v={keyword.gscImpressions} />
            </div>
            {keyword.gscPosition > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                Avg GSC position: {keyword.gscPosition.toFixed(1)}
              </div>
            )}
          </Section>

          {keyword.topResults.length > 0 && (
            <Section title={`Top 10 (${keyword.topResults.length})`}>
              <ul className="space-y-1 text-xs">
                {keyword.topResults.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <div>
                      <div className="font-medium">{r.title || "(no title)"}</div>
                      <div className="text-muted-foreground">{r.domain}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {keyword.paas.length > 0 && (
            <Section title={`PAA (${keyword.paas.length})`}>
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {keyword.paas.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </Section>
          )}

          {keyword.related.length > 0 && (
            <Section title={`Related (${keyword.related.length})`}>
              <div className="flex flex-wrap gap-1">
                {keyword.related.map((r, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{r}</Badge>
                ))}
              </div>
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="rounded border p-2">
      <div className="text-muted-foreground text-xs">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}