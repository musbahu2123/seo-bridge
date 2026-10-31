// app/(admin)/sites/page.tsx — tenant list (server component)
import Link from "next/link";
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
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

export const dynamic = "force-dynamic"; // always fresh — never statically cache the tenant list

type SiteRow = {
  _id: string;
  name: string;
  domain: string;
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

  const sites = (raw as unknown as SiteRow[]).map((s) => ({
    ...s,
    _id: String(s._id),
    hasPublishKey: !!s.publishKey && s.publishKey !== "",
    hasGscToken: !!s.gscRefreshToken && s.gscRefreshToken !== "",
  }));

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
                  <TableHead>Competitors</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.domain}
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