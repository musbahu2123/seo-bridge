// app/api/jobs/gsc-sync/route.ts — weekly GSC sync
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
import Keyword from "@/models/Keyword";
import WeeklySnapshot from "@/models/WeeklySnapshot";
import { markJobFinished } from "@/lib/schedule";
import {
  getAccessToken,
  searchAnalyticsAll,
  window28d,
} from "@/lib/gsc";

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

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  const day = x.getUTCDay();
  const diff = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const sites = await Site.find({
    active: true,
    gscRefreshToken: { $ne: null },
  });

  const results: Array<{
    site: string;
    ok: boolean;
    error?: string;
    snapshot?: unknown;
    newKeywords?: number;
    ctrOpportunities?: number;
    cannibalization?: number;
  }> = [];

  for (const site of sites) {
    try {
      const token = await getAccessToken(site.gscRefreshToken as string);
      const win = window28d();

      const [cur, prev] = await Promise.all([
        searchAnalyticsAll(token, {
          siteUrl: site.gscSiteUrl!,
          startDate: win.startDate,
          endDate: win.endDate,
          dimensions: ["query"],
        }),
        searchAnalyticsAll(token, {
          siteUrl: site.gscSiteUrl!,
          startDate: win.prevStartDate,
          endDate: win.prevEndDate,
          dimensions: ["query"],
        }),
      ]);

      const pageRows = await searchAnalyticsAll(token, {
        siteUrl: site.gscSiteUrl!,
        startDate: win.startDate,
        endDate: win.endDate,
        dimensions: ["query", "page"],
      });

      let clicks = 0;
      let impressions = 0;
      let posWeighted = 0;
      for (const r of cur) {
        clicks += r.clicks;
        impressions += r.impressions;
        posWeighted += r.position * r.impressions;
      }
      const avgPosition = impressions > 0 ? posWeighted / impressions : 0;
      const ctr = impressions > 0 ? clicks / impressions : 0;

      const curQueries = new Set(cur.map((r) => r.keys[0]));
      const prevQueries = new Set(prev.map((r) => r.keys[0]));
      const newQueries = [...curQueries].filter((q) => !prevQueries.has(q));
      const lostQueries = [...prevQueries].filter((q) => !curQueries.has(q));

      const queryToPages = new Map<string, Set<string>>();
      for (const r of pageRows) {
        const [q, page] = r.keys;
        if (!queryToPages.has(q)) queryToPages.set(q, new Set());
        queryToPages.get(q)!.add(page);
      }
      const cannibals = [...queryToPages.entries()].filter(
        ([, pages]) => pages.size >= 2,
      );

      const week = mondayOf(new Date());
      await WeeklySnapshot.findOneAndUpdate(
        { site: site._id, week },
        {
          $set: {
            clicks,
            impressions,
            ctr,
            avgPosition,
            newQueries,
            lostQueries,
            notes: cannibals.length
              ? `Cannibalization: ${cannibals.length} queries map to 2+ pages`
              : "",
          },
        },
        { upsert: true, new: true },
      );

      let newKw = 0;
      let ctrOpps = 0;
      for (const r of cur) {
        const q = r.keys[0];
        if (!q) continue;
        const isNew = !prevQueries.has(q);
        const isCtrOpp =
          r.position >= 4 && r.position <= 20 && r.impressions >= 20;

        if (!isNew && !isCtrOpp) continue;

        const existing = await Keyword.findOne({
          site: site._id,
          keyword: q,
        }).lean();
        if (existing) {
          await Keyword.updateOne(
            { _id: existing._id },
            {
              $set: {
                gscImpressions: Math.round(r.impressions),
                gscPosition: Number(r.position.toFixed(2)),
                lastScoredAt: new Date(),
              },
            },
          );
          continue;
        }

        await Keyword.create({
          site: site._id,
          keyword: q,
          source: "gsc",
          status: "new",
          gscImpressions: Math.round(r.impressions),
          gscPosition: Number(r.position.toFixed(2)),
        });
        newKw++;
        if (isCtrOpp) ctrOpps++;
      }

      results.push({
        site: String(site._id),
        ok: true,
        snapshot: { clicks, impressions, ctr, avgPosition },
        newKeywords: newKw,
        ctrOpportunities: ctrOpps,
        cannibalization: cannibals.length,
      });
    } catch (err) {
      results.push({
        site: String(site._id),
        ok: false,
        error: String((err as Error)?.message ?? err),
      });
    }
  }

  await markJobFinished(
    "gsc-sync",
    true,
    `${results.filter((r) => r.ok).length}/${results.length} sites ok`,
  );
  return NextResponse.json({ ok: true, results });
}