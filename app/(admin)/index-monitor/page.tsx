import dbConnect from "@/lib/dbConnect";
import PageIndex from "@/models/PageIndex";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function IndexMonitorPage() {
  await dbConnect();
  const pages = await PageIndex.find({ type: "own" })
    .sort({ lastInspected: -1 })
    .limit(500)
    .lean();

  const unindexed = pages.filter(
    (p) => !p.coverageState || !/^Indexed$/i.test(p.coverageState),
  );

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Index monitor</h1>
        <p className="text-sm text-muted-foreground">
          Own pages: {pages.length} tracked · {unindexed.length} not indexed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Own pages</CardTitle>
        </CardHeader>
        <CardContent>
          {pages.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nothing inspected yet. Run <code>index-monitor</code> (Batch 12) — first run bulk-inspects the whole sitemap.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Indexing</TableHead>
                  <TableHead>Inspected</TableHead>
                  <TableHead className="text-right">#</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.map((p) => (
                  <TableRow key={String(p._id)}>
                    <TableCell className="max-w-md truncate font-mono text-xs">{p.url}</TableCell>
                    <TableCell>
                      <Badge variant={/^Indexed$/i.test(p.coverageState || "") ? "default" : "destructive"}>
                        {p.coverageState || "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{p.indexingState || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.lastInspected ? new Date(p.lastInspected).toISOString().slice(0, 16).replace("T", " ") : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs">{p.timesInspected ?? 0}</TableCell>
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