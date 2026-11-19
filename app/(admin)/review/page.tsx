import Link from "next/link";
import dbConnect from "@/lib/dbConnect";
import ArticleJob from "@/models/ArticleJob";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  await dbConnect();
  const filter: Record<string, unknown> = {};
  if (sp.status) filter.status = sp.status;
  else filter.status = "awaiting_review";

  const jobs = await ArticleJob.find(filter).sort({ createdAt: -1 }).limit(200).lean();

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-muted-foreground">
          Nothing publishes without approval. Approve → Publish when ready.
        </p>
      </div>

      <div className="flex gap-2 text-sm">
        <Link href="/review" className={!sp.status ? "font-medium" : "text-muted-foreground"}>Awaiting</Link>
        <Link href="/review?status=approved" className={sp.status === "approved" ? "font-medium" : "text-muted-foreground"}>Approved</Link>
        <Link href="/review?status=pushed" className={sp.status === "pushed" ? "font-medium" : "text-muted-foreground"}>Pushed</Link>
        <Link href="/review?status=rejected" className={sp.status === "rejected" ? "font-medium" : "text-muted-foreground"}>Rejected</Link>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{jobs.length} job{jobs.length === 1 ? "" : "s"}</CardTitle></CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No jobs. Run <code>brief-generator</code> after approving keywords.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={String(j._id)}>
                    <TableCell className="max-w-md truncate font-medium">{j.title}</TableCell>
                    <TableCell className="text-xs">{j.category}</TableCell>
                    <TableCell>
                      <Badge variant={j.status === "pushed" ? "default" : "secondary"}>{j.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/review/${j._id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}