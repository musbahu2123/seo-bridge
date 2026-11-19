import dbConnect from "@/lib/dbConnect";
import LinkTask from "@/models/LinkTask";
import Site from "@/models/Site";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkTaskForm } from "@/components/LinkTaskForm";
import { LinkTaskTable } from "@/components/LinkTaskTable";

export const dynamic = "force-dynamic";

export default async function LinksPage() {
  await dbConnect();
  const sites = await Site.find({ active: true }).lean();
  const siteId = sites[0] ? String(sites[0]._id) : "";
  const links = await LinkTask.find({}).sort({ createdAt: -1 }).limit(500).lean();

  const rows = links.map((l) => ({
    _id: String(l._id),
    play: l.play,
    targetDomain: l.targetDomain,
    targetUrl: l.targetUrl ?? "",
    pageType: l.pageType,
    dr: l.dr ?? null,
    status: l.status,
    contact: l.contact ?? "",
    placedUrl: l.placedUrl ?? "",
    judgeAfter: l.judgeAfter ? new Date(l.judgeAfter).toISOString() : null,
    placedAt: l.placedAt ? new Date(l.placedAt).toISOString() : null,
  }));

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Links CRM</h1>
        <p className="text-sm text-muted-foreground">
          The $0 links CRM. All plays, all prospects. Cost is always 0 — decline paid placements.
        </p>
      </div>

      {siteId ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Add prospect</CardTitle></CardHeader>
          <CardContent><LinkTaskForm siteId={siteId} /></CardContent>
        </Card>
      ) : (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">Create a site first.</CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{rows.length} prospect{rows.length === 1 ? "" : "s"}</CardTitle></CardHeader>
        <CardContent><LinkTaskTable links={rows} /></CardContent>
      </Card>
    </div>
  );
}