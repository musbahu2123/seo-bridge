// app/api/jobs/bing-submit/route.ts — daily Bing URL submission
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
import PageIndex from "@/models/PageIndex";
import { markJobFinished } from "@/lib/schedule";
import { bingSubmitUrls } from "@/lib/bing";

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

async function fetchSitemapUrls(sitemapUrl: string, max = 10000): Promise<string[]> {
  try {
    const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const urls: string[] = [];
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null && urls.length < max) urls.push(m[1]);
    return urls;
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();

  const sites = await Site.find({ active: true });
  const summary: Array<{ site: string; submitted: number; ok: boolean; detail: string }> = [];

  for (const site of sites) {
    try {
      const origin = `https://${site.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

      const tracked = await PageIndex.countDocuments({ site: site._id, type: "own" });
      let urls: string[];
      if (tracked < 5) {
        urls = await fetchSitemapUrls(site.sitemapUrl, 10000);
      } else {
        const recent = await PageIndex.find({ site: site._id, type: "own" })
          .sort({ firstSeen: -1 })
          .limit(200)
          .lean();
        urls = recent.map((r) => r.url);
      }

      const r = await bingSubmitUrls(origin + "/", urls);
      summary.push({ site: String(site._id), submitted: urls.length, ok: r.ok, detail: r.detail });
    } catch (e) {
      summary.push({ site: String(site._id), submitted: 0, ok: false, detail: String(e) });
    }
  }

  await markJobFinished(
    "bing-submit",
    true,
    `${summary.reduce((a, s) => a + s.submitted, 0)} urls submitted`,
  );
  return NextResponse.json({ ok: true, summary });
}