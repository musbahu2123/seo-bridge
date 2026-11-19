
// app/(admin)/dashboard/page.tsx — real dashboard (Batch 6)

import Link from "next/link";
import { getDashboardStats } from "@/lib/dashboard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const s = await getDashboardStats();

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live counts across sites, keywords, articles, indexing and links.
          </p>
        </div>

        <Button render={<Link href="/sites" />}>
          Manage sites
        </Button>
      </div>

      {/* Top stat row — one card per domain area */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Sites"
          value={s.sites.total}
          sub={`${s.sites.active} active · ${s.sites.gscConnected} GSC · ${s.sites.publishKeySet} key`}
          href="/sites"
        />

        <StatCard
          title="Keywords"
          value={s.keywords.total}
          sub={`${s.keywords.target} target · ${s.keywords.watch} watch · ${s.keywords.park} park`}
          href="/keywords"
        />

        <StatCard
          title="Articles"
          value={s.articles.total}
          sub={`${s.articles.awaitingReview} awaiting · ${s.articles.pushed} pushed`}
          href="/review"
        />

        <StatCard
          title="Links"
          value={s.links.total}
          sub={`${s.links.placedTotal} placed · ${s.links.placedLast30d} in last 30d`}
          href="/links"
        />
      </div>

      {/* Two-column: pending work + latest snapshot */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pending work */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs attention</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <PendingRow
              label="Articles awaiting review"
              count={s.articles.awaitingReview}
              href="/review"
              cta="Review"
            />

            <PendingRow
              label="Own pages not indexed"
              count={s.pages.unindexedOwn}
              href="/index-monitor"
              cta="Inspect"
            />

            <PendingRow
              label="Keywords approved (ready to brief)"
              count={s.keywords.byStatus.approved ?? 0}
              href="/keywords?status=approved"
              cta="Open"
            />

            <PendingRow
              label="Link prospects not yet sent"
              count={s.links.byStatus.prospect ?? 0}
              href="/links?status=prospect"
              cta="Open"
            />
          </CardContent>
        </Card>

        {/* Latest snapshot */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Latest GSC snapshot

              {s.latestSnapshot?.week && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  week of {s.latestSnapshot.week}
                </span>
              )}
            </CardTitle>
          </CardHeader>

          <CardContent>
            {!s.latestSnapshot ? (
              <p className="py-6 text-sm text-muted-foreground">
                No snapshot yet. gsc-sync (Batch 7) writes the first one after
                you connect Search Console.
              </p>
            ) : (
              <Table>
                <TableBody>
                  <SnapshotRow
                    label="Clicks"
                    value={s.latestSnapshot.clicks}
                  />

                  <SnapshotRow
                    label="Impressions"
                    value={s.latestSnapshot.impressions}
                  />

                  <SnapshotRow
                    label="CTR"
                    value={`${(s.latestSnapshot.ctr * 100).toFixed(2)}%`}
                  />

                  <SnapshotRow
                    label="Avg position"
                    value={s.latestSnapshot.avgPosition.toFixed(1)}
                  />

                  <SnapshotRow
                    label="Referring domains"
                    value={s.latestSnapshot.referringDomains}
                  />
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pipeline at a glance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline</CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <PipelineCell
              label="Keywords"
              rows={[
                ["New", s.keywords.byStatus.new ?? 0],
                ["Approved", s.keywords.byStatus.approved ?? 0],
                ["Briefed", s.keywords.byStatus.briefed ?? 0],
                ["Published", s.keywords.byStatus.published ?? 0],
              ]}
            />

            <PipelineCell
              label="Articles"
              rows={[
                ["Awaiting", s.articles.awaitingReview],
                ["Approved", s.articles.approved],
                ["Pushed", s.articles.pushed],
                ["Rejected", s.articles.rejected],
              ]}
            />

            <PipelineCell
              label="Pages"
              rows={[
                ["Own", s.pages.own],
                ["External", s.pages.external],
                ["Unindexed", s.pages.unindexedOwn],
              ]}
            />

            <PipelineCell
              label="Links"
              rows={[
                ["Prospect", s.links.byStatus.prospect ?? 0],
                ["Sent", s.links.byStatus.sent ?? 0],
                ["Replied", s.links.byStatus.replied ?? 0],
                ["Placed", s.links.byStatus.placed ?? 0],
              ]}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Small presentational helpers ── */

function StatCard({
  title,
  value,
  sub,
  href,
}: {
  title: string;
  value: number;
  sub: string;
  href: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="transition-colors hover:border-foreground/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="text-2xl font-semibold">{value}</div>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function PendingRow({
  label,
  count,
  href,
  cta,
}: {
  label: string;
  count: number;
  href: string;
  cta: string;
}) {
  const isZero = count === 0;

  return (
    <div className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-2">
        <span className="text-sm">{label}</span>

        {isZero ? (
          <Badge variant="outline">0</Badge>
        ) : (
          <Badge>{count}</Badge>
        )}
      </div>

      {!isZero && (
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={href} />}
        >
          {cta}
        </Button>
      )}
    </div>
  );
}

function SnapshotRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right font-medium">{value}</TableCell>
    </TableRow>
  );
}

function PipelineCell({
  label,
  rows,
}: {
  label: string;
  rows: [string, number][];
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>

      <div className="space-y-1">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
