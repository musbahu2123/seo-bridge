// Daily index monitor (GSC URL Inspection).
// First run per site: bulk-inspect ALL sitemap URLs (Amendment A).
// Subsequent runs: only the 20 newest own pages.
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
import PageIndex from "@/models/PageIndex";
import { getAccessToken, inspectUrl, type InspectionResult } from "@/lib/gsc";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  return (
    url.searchParams.get("key") === secret ||
    req.headers.get("x-cron-secret") === secret
  );
}

async function fetchSitemapUrls(sitemapUrl: string, max = 500): Promise<string[]> {
  try {
    const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const urls: string[] = [];
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null && urls.length < max) urls.push(m[1]);
    // sitemap-index → recurse one level
    const sitemapRefs = urls.filter((u) => u.endsWith(".xml"));
    if (sitemapRefs.length > 0) {
      const nested: string[] = [];
      for (const ref of sitemapRefs.slice(0, 10)) {
        const more = await fetchSitemapUrls(ref, max);
        nested.push(...more);
      }
      return [...new Set([...urls.filter((u) => !u.endsWith(".xml")), ...nested])];
    }
    return urls;
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();

  const url = new URL(req.url);
  const onlySite = url.searchParams.get("site");

  const siteFilter: Record<string, unknown> = { active: true, gscRefreshToken: { $ne: null } };
  if (onlySite) siteFilter._id = onlySite;
  const sites = await Site.find(siteFilter);

  const summary: Array<{ site: string; inspected: number; errors: string[] }> = [];

  for (const site of sites) {
    const errors: string[] = [];
    let inspected = 0;

    try {
      const token = await getAccessToken(site.gscRefreshToken as string);
      const siteUrlForInspect = site.gscSiteUrl!;

      const existingOwn = await PageIndex.countDocuments({ site: site._id, type: "own" });
      let targets: string[] = [];

      if (existingOwn === 0) {
        // FIRST RUN: bulk-inspect entire sitemap
        const sitemapUrls = await fetchSitemapUrls(site.sitemapUrl, 500);
        targets = sitemapUrls.slice(0, 1900); // stay under 2000/day quota
        for (const u of sitemapUrls.slice(0, 1900)) {
          await PageIndex.updateOne(
            { site: site._id, url: u },
            {
              $setOnInsert: {
                site: site._id, type: "own", url: u, firstSeen: new Date(),
              },
            },
            { upsert: true },
          );
        }
      } else {
        // Routine: newest own URLs
        const recent = await PageIndex.find({ site: site._id, type: "own" })
          .sort({ firstSeen: -1 })
          .limit(20)
          .lean();
        targets = recent.map((r) => r.url);
      }

      for (const u of targets) {
        try {
          const r: InspectionResult = await inspectUrl(token, siteUrlForInspect, u);
          await PageIndex.updateOne(
            { site: site._id, url: u },
            {
              $set: {
                coverageState: r.coverageState,
                indexingState: r.indexingState,
                lastInspected: new Date(),
              },
              $inc: { timesInspected: 1 },
            },
          );
          inspected++;
        } catch (e) {
          errors.push(`${u}: ${String((e as Error)?.message ?? e).slice(0, 150)}`);
        }
      }
    } catch (e) {
      errors.push(`site: ${String((e as Error)?.message ?? e)}`);
    }

    summary.push({ site: String(site._id), inspected, errors: errors.slice(0, 5) });
  }

  return NextResponse.json({ ok: true, summary });
}