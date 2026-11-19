import dbConnect from "@/lib/dbConnect";
import WeeklySnapshot from "@/models/WeeklySnapshot";
import Site from "@/models/Site";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await dbConnect();
  const sites = await Site.find({}).lean();
  const snapshots = await WeeklySnapshot.find({}).sort({ week: -1 }).limit(100).lean();

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Weekly snapshots written by gsc-sync + linkreview. Newest first.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Snapshots</CardTitle></CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No snapshots yet. Run <code>gsc-sync</code> after connecting GSC.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Impr.</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Pos.</TableHead>
                  <TableHead className="text-right">Ref. domains</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((s) => {
                  const siteName = sites.find((x) => String(x._id) === String(s.site))?.name ?? String(s.site).slice(0, 8);
                  return (
                    <TableRow key={String(s._id)}>
                      <TableCell className="font-mono text-xs">{s.week ? new Date(s.week).toISOString().slice(0, 10) : ""}</TableCell>
                      <TableCell>{siteName}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.clicks}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.impressions}</TableCell>
                      <TableCell className="text-right tabular-nums">{(s.ctr * 100).toFixed(2)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{s.avgPosition.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.referringDomains}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}