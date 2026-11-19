// app/(admin)/sites/page.tsx — tenant list with style profile status
import Link from "next/link";
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
import StyleProfile from "@/models/StyleProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RefreshStyleButton } from "@/components/RefreshStyleButton";

export const dynamic = "force-dynamic";

type SiteRow = {
  _id: string;
  name: string;
  domain: string;
  contentResponsePath?: string;
  sitemapUrl: string;
  publishUrl: string;
  publishKey?: string;
  gscRefreshToken?: string | null;
  gscSiteUrl?: string | null;
  competitors: string[];
  active: boolean;
};

export default async function SitesPage() {
  await dbConnect();
  const raw = await Site.find({}).sort({ createdAt: -1 }).lean();

  // Load active StyleProfile for all sites in one query
  const siteIds = raw.map((s) => s._id);
  const profiles = siteIds.length
    ? await StyleProfile.find({
        site: { $in: siteIds },
        isActive: true,
      }).lean()
    : [];
  const profileBySiteId = new Map(
    profiles.map((p) => [String(p.site), p]),
  );

  const sites = (raw as unknown as SiteRow[]).map((s) => {
    const profile = profileBySiteId.get(String(s._id));
    return {
      ...s,
      _id: String(s._id),
      hasPublishKey: !!s.publishKey && s.publishKey !== "",
      hasGscToken: !!s.gscRefreshToken && s.gscRefreshToken !== "",
      contentResponsePath: s.contentResponsePath ?? "",
      styleVersion: profile?.version ?? null,
      styleLearnedFrom: profile?.learnedFrom ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Tenants the bridge manages. Each one is a separate SaaS with its own
            GSC property and publish endpoint.
          </p>
        </div>
        <Button asChild>
          <Link href="/sites/new">New site</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {sites.length} {sites.length === 1 ? "tenant" : "tenants"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sites.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No tenants yet. Add your first one — ResumeTailorApp.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>GSC</TableHead>
                  <TableHead>Publish key</TableHead>
                  <TableHead>Style</TableHead>
                  <TableHead>Competitors</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <div>{s.domain}</div>
                      {s.contentResponsePath && (
                        <div className="mt-0.5 text-xs">
                          <span className="text-muted-foreground/70">
                            response path:{" "}
                          </span>
                          <code className="rounded bg-muted px-1 py-0.5 text-xs">
                            {s.contentResponsePath}
                          </code>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.hasGscToken ? (
                        <Badge variant="secondary">Connected</Badge>
                      ) : (
                        <Badge variant="outline">Not connected</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.hasPublishKey ? (
                        <Badge variant="secondary">Set</Badge>
                      ) : (
                        <Badge variant="outline">Pending patch</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {s.styleVersion !== null ? (
                          <div className="text-xs">
                            <Badge variant="secondary">v{s.styleVersion}</Badge>
                            <span className="ml-1 text-muted-foreground">
                              · {s.styleLearnedFrom ?? 0} posts
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            Not learned
                          </div>
                        )}
                        <RefreshStyleButton
                          siteId={s._id}
                          hasProfile={s.styleVersion !== null}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.competitors.length}
                    </TableCell>
                    <TableCell>
                      {s.active ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
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