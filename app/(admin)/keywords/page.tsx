// app/(admin)/keywords/page.tsx — keyword pipeline + landing-page todo queue
import Link from "next/link";
import dbConnect from "@/lib/dbConnect";
import Keyword from "@/models/Keyword";
import LandingTodo from "@/models/LandingTodo";
import Site from "@/models/Site";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KeywordTable } from "@/components/KeywordTable";

export const dynamic = "force-dynamic";

const DECISIONS = ["TARGET", "WATCH", "PARK"] as const;
const STATUSES = [
  "new",
  "approved",
  "briefed",
  "published",
  "watch",
  "rejected",
] as const;

export default async function KeywordsPage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string; status?: string; site?: string }>;
}) {
  const sp = await searchParams;
  await dbConnect();

  const filter: Record<string, unknown> = {};
  if (sp.decision) filter.decision = sp.decision;
  if (sp.status) filter.status = sp.status;
  if (sp.site) filter.site = sp.site;

  const keywords = await Keyword.find(filter)
    .sort({ opportunityScore: -1, createdAt: -1 })
    .limit(500)
    .lean();

  const rows = keywords.map((k) => ({
    _id: String(k._id),
    keyword: k.keyword,
    source: k.source,
    status: k.status,
    decision: k.decision,
    opportunityScore: k.opportunityScore ?? 0,
    demand: k.demand ?? 0,
    serpOpp: k.serpOpp ?? 0,
    fit: k.fit ?? 0,
    overrideReason: k.overrideReason ?? "",
    giantsInTop10: k.giantsInTop10 ?? 0,
    weakSitesInTop10: k.weakSitesInTop10 ?? 0,
    topResults: (k.topResults ?? []).map((r) => ({
      title: r.title ?? "",
      domain: r.domain ?? "",
    })),
    paas: k.paas ?? [],
    related: k.related ?? [],
    gscImpressions: k.gscImpressions ?? 0,
    gscPosition: k.gscPosition ?? 0,
    intent: k.intent ?? null,
    cannibalizedBy:
      k.cannibalizedBy && k.cannibalizedBy.url
        ? {
            url: k.cannibalizedBy.url,
            slug: k.cannibalizedBy.slug ?? "",
            title: k.cannibalizedBy.title ?? "",
            matchedKeyword: k.cannibalizedBy.matchedKeyword ?? "",
            confidence: k.cannibalizedBy.confidence ?? "",
          }
        : null,
    featuredSnippetType: k.featuredSnippetType ?? null,
  }));

  // ── LandingTodos (open items only) ──
  const landingFilter: Record<string, unknown> = {
    status: { $in: ["new", "in-progress"] },
  };
  if (sp.site) landingFilter.site = sp.site;
  const landingTodos = await LandingTodo.find(landingFilter)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const siteIds = Array.from(
    new Set(landingTodos.map((t) => String(t.site))),
  );
  const siteDocs = siteIds.length
    ? await Site.find({ _id: { $in: siteIds } })
        .select("_id name")
        .lean()
    : [];
  const siteNameById = new Map(
    siteDocs.map((s) => [String(s._id), s.name]),
  );

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Keywords</h1>
        <p className="text-sm text-muted-foreground">
          Candidates scored by the Opportunity Score engine. Approve to brief.
        </p>
      </div>

      {/* ── Landing Todos (R3 flag-only queue) ── */}
      {landingTodos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span>Landing page queue</span>
              <Badge variant="secondary">{landingTodos.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              These keywords are landing-page-shaped. Build the page in the SaaS,
              then clear the flag on the source ArticleJob. The bridge does not
              draft landing pages.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Suggested slug</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {landingTodos.map((t) => (
                  <TableRow key={String(t._id)}>
                    <TableCell className="max-w-xs truncate font-medium">
                      {t.keyword}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {siteNameById.get(String(t.site)) ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {t.suggestedSlug || "—"}
                    </TableCell>
                    <TableCell className="max-w-sm truncate text-xs">
                      {t.reason || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.status === "new" ? "default" : "secondary"
                        }
                      >
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.createdAt
                        ? new Date(t.createdAt).toISOString().slice(0, 10)
                        : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Decision:</span>
        <Link
          href="/keywords"
          className={!sp.decision ? "font-medium" : "text-muted-foreground"}
        >
          All
        </Link>
        {DECISIONS.map((d) => (
          <Link
            key={d}
            href={`/keywords?decision=${d}`}
            className={sp.decision === d ? "font-medium" : "text-muted-foreground"}
          >
            {d}
          </Link>
        ))}

        <span className="ml-4 text-muted-foreground">Status:</span>
        <Link
          href={`/keywords${sp.decision ? `?decision=${sp.decision}` : ""}`}
          className={!sp.status ? "font-medium" : "text-muted-foreground"}
        >
          All
        </Link>
        {STATUSES.map((st) => (
          <Link
            key={st}
            href={`/keywords?${sp.decision ? `decision=${sp.decision}&` : ""}status=${st}`}
            className={sp.status === st ? "font-medium" : "text-muted-foreground"}
          >
            {st}
          </Link>
        ))}
      </div>

      {/* ── Keyword table ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {rows.length} keyword{rows.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <KeywordTable keywords={rows} />
        </CardContent>
      </Card>
    </div>
  );
}