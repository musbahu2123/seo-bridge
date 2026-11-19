//app/(admin)/review/[id]/regenerate/page.tsx
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

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
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

      <div className="flex flex-wrap gap-2">
        <Badge>{job.status}</Badge>
        {job.metaTitle && (
          <Badge variant="outline">meta: {job.metaTitle.length} chars</Badge>
        )}
        {job.metaDescription && (
          <Badge variant="outline">
            desc: {job.metaDescription.length} chars
          </Badge>
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