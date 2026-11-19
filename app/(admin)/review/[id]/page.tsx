// app/(admin)/review/[id]/page.tsx — review detail with SEO checklist + flags
import Link from "next/link";
import { notFound } from "next/navigation";
import dbConnect from "@/lib/dbConnect";
import ArticleJob from "@/models/ArticleJob";
import Keyword from "@/models/Keyword";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReviewActions } from "@/components/ReviewActions";
import { YouTubeContextInput } from "@/components/YouTubeContextInput";

export const dynamic = "force-dynamic";

type SeoCheck = {
  key: string;
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
};

export default async function ReviewDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await dbConnect();
  const job = await ArticleJob.findById(id).lean();
  if (!job) notFound();

  const kw = await Keyword.findById(job.keywordId).lean();

  const wordCount = (job.draft || "")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  const emDashCount = (job.draft || "").match(/—/g)?.length ?? 0;

  const seo = job.seoValidation ?? {
    pass: true,
    hardFails: [],
    warnings: [],
    checks: [],
    forceOverride: false,
  };
  const checks: SeoCheck[] = (seo.checks ?? []) as SeoCheck[];

  const landingFlagged = job.landingFlag?.flagged === true;
  const cannibalized = !!kw?.cannibalizedBy?.url;

  // Count by status for the summary line
  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">
            {job.title || "(untitled)"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Keyword: <strong>{kw?.keyword ?? "?"}</strong> · {job.category} ·{" "}
            {job.readTime}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/review">Back to queue</Link>
        </Button>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-2">
        <Badge>{job.status}</Badge>
        {seo.pass ? (
          <Badge variant="default">SEO: pass ({passCount} checks)</Badge>
        ) : (
          <Badge variant="destructive">
            SEO: {failCount} fail{failCount === 1 ? "" : "s"}
            {warnCount > 0 ? ` · ${warnCount} warn` : ""}
          </Badge>
        )}
        {seo.forceOverride && (
          <Badge variant="destructive">FORCE OVERRIDE active</Badge>
        )}
        {job.metaTitle && (
          <Badge variant="outline">meta: {job.metaTitle.length} chars</Badge>
        )}
        {job.metaDescription && (
          <Badge variant="outline">desc: {job.metaDescription.length} chars</Badge>
        )}
        <Badge variant="outline">slug: {job.slug}</Badge>
        <Badge variant="outline">{wordCount} words</Badge>
        {emDashCount > 0 ? (
          <Badge variant="destructive">{emDashCount} em dashes</Badge>
        ) : (
          <Badge variant="secondary">no em dashes</Badge>
        )}
        {job.youtubeTranscript && (
          <Badge variant="secondary">
            YouTube: {job.youtubeTranscript.length} chars
          </Badge>
        )}
      </div>

      {/* ── Banner: landing flag ── */}
      {landingFlagged && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">Flagged for landing page</div>
          <p className="mt-1 text-xs">
            {job.landingFlag.reason ||
              "This keyword is landing-shaped — a blog post is the wrong format."}
          </p>
          <p className="mt-1 text-xs">
            Handle this manually in the SaaS (create the landing page), then clear
            the flag on this job before publishing. Publisher will refuse until
            cleared.
          </p>
        </div>
      )}

      {/* ── Banner: cannibalization ── */}
      {cannibalized && (
        <div className="rounded-md border border-red-500/40 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-medium">Source keyword is cannibalized</div>
          <p className="mt-1 text-xs">
            This keyword duplicates an existing post:{" "}
            <a
              href={kw!.cannibalizedBy.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {kw!.cannibalizedBy.title || kw!.cannibalizedBy.url}
            </a>
          </p>
          <p className="mt-1 text-xs">
            Match confidence: {kw!.cannibalizedBy.confidence} · matched keyword:{" "}
            <code className="rounded bg-white/60 px-1">
              {kw!.cannibalizedBy.matchedKeyword}
            </code>
          </p>
        </div>
      )}

      {/* SEO checklist card — the big addition */}
      {checks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>SEO formula checklist</span>
              <span className="text-xs font-normal text-muted-foreground">
                {passCount} pass · {failCount} fail · {warnCount} warn
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {checks.map((c) => (
                <div
                  key={c.key}
                  className="flex items-start gap-3 py-2 text-sm"
                >
                  <span className="shrink-0 pt-0.5">
                    {c.status === "pass" && (
                      <span className="text-green-600">✓</span>
                    )}
                    {c.status === "fail" && (
                      <span className="text-red-600">✗</span>
                    )}
                    {c.status === "warn" && (
                      <span className="text-amber-600">⚠</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.label}</div>
                    <div className="break-words text-xs text-muted-foreground">
                      {c.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Brief + draft */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Brief</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-xs uppercase text-muted-foreground">
                Angle
              </div>
              <p className="whitespace-pre-wrap">{job.brief || "(empty)"}</p>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">
                CTA plan
              </div>
              <p className="whitespace-pre-wrap">{job.ctaPlan || "(empty)"}</p>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">
                Outline
              </div>
              <ol className="list-decimal pl-4 space-y-0.5">
                {(job.outline ?? []).map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            </div>
            {job.faqs && job.faqs.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  FAQs ({job.faqs.length})
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  {job.faqs.map((f, i) => (
                    <li key={i}>{f.q}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Draft (rendered)</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: job.draft }}
            />
          </CardContent>
        </Card>
      </div>

      <YouTubeContextInput
        jobId={String(job._id)}
        initialUrl={job.youtubeUrl ?? ""}
        initialTranscript={job.youtubeTranscript ?? ""}
        disabled={job.status === "pushed"}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewActions jobId={String(job._id)} status={job.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Raw HTML</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            readOnly
            value={job.draft}
            rows={12}
            className="w-full rounded border bg-muted p-2 font-mono text-xs"
          />
        </CardContent>
      </Card>
    </div>
  );
}