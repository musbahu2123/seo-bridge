// app/api/jobs/keyword-harvest/route.ts — weekly keyword harvesting
//
// Pipeline (brief §3.5):
//   seeds (GSC queries + competitor sitemap titles)
//     → Google Autocomplete expansion (free)
//     → Serper SERP + PAA + related (1 credit per seed)
//     → Opportunity Score engine
//     → upsert Keyword rows
//
// Auth: ?key=CRON_SECRET or x-cron-secret header.
// Query params:
//   ?site=<siteId>      → harvest only that site
//   ?dry=1              → don't write, just return what would be written
//   ?limit=<n>          → max seeds to fetch SERPs for (default 20 — watch your Serper credits)

import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
import Keyword from "@/models/Keyword";
import { autocompleteExpand } from "@/lib/autocomplete";
import { serperSearch } from "@/lib/serper";
import {
  scoreKeyword,
  heuristicFit,
  type SerpResult,
} from "@/lib/score";

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

type Seed = { keyword: string; source: "gsc" | "competitor" | "serper" };

async function fetchSitemapTitles(url: string, max = 40): Promise<string[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const xml = await res.text();
    // Grab URLs from <loc>...</loc>
    const locs: string[] = [];
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null && locs.length < max) locs.push(m[1]);
    // Turn slugs into keywords: "/blog/how-to-negotiate-salary" → "how to negotiate salary"
    return locs
      .map((u) => {
        try {
          const path = new URL(u).pathname;
          const last = path.split("/").filter(Boolean).pop() ?? "";
          return last.replace(/-/g, " ").trim();
        } catch {
          return "";
        }
      })
      .filter((s) => s.length >= 6 && s.split(" ").length >= 2);
  } catch {
    return [];
  }
}

async function collectSeeds(site: {
  _id: unknown;
  sitemapUrl: string;
  competitors: string[];
}): Promise<Seed[]> {
  const seeds: Seed[] = [];

  // 1. Existing GSC queries (source: gsc)
  const gscKws = await Keyword.find({
    site: site._id,
    source: "gsc",
  })
    .sort({ gscImpressions: -1 })
    .limit(15)
    .lean();
  for (const k of gscKws) seeds.push({ keyword: k.keyword, source: "gsc" });

  // 2. Competitor sitemap titles (source: competitor)
  for (const c of site.competitors.slice(0, 3)) {
    const url = `https://${c.replace(/^https?:\/\//, "")}/sitemap.xml`;
    const titles = await fetchSitemapTitles(url, 20);
    for (const t of titles)
      seeds.push({ keyword: t, source: "competitor" });
  }

  // Dedupe by keyword, keep first source
  const seen = new Set<string>();
  const out: Seed[] = [];
  for (const s of seeds) {
    const key = s.keyword.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const limit = Math.max(
    1,
    Math.min(Number(url.searchParams.get("limit") ?? 20), 50),
  );
  const onlySite = url.searchParams.get("site");

  await dbConnect();

  const siteFilter: Record<string, unknown> = { active: true };
  if (onlySite) siteFilter._id = onlySite;
  const sites = await Site.find(siteFilter);

  const summary: Array<{
    site: string;
    seeds: number;
    fetchedSerps: number;
    newKeywords: number;
    target: number;
    watch: number;
    park: number;
    errors: string[];
  }> = [];

  for (const site of sites) {
    const errors: string[] = [];

    // 1. Collect seeds
    const seeds = await collectSeeds(site);
    // Prioritize gsc seeds, then competitor
    seeds.sort((a, b) =>
      a.source === b.source ? 0 : a.source === "gsc" ? -1 : 1,
    );
    const topSeeds = seeds.slice(0, limit);

    // 2. Autocomplete expansion for each seed (cheap, no key)
    const autocompleteHits = new Map<string, number>();
    for (const s of topSeeds.slice(0, 8)) {
      try {
        const { variants } = await autocompleteExpand(s.keyword);
        for (const v of variants) {
          const k = v.toLowerCase();
          autocompleteHits.set(k, (autocompleteHits.get(k) ?? 0) + 1);
        }
      } catch (e) {
        errors.push(`autocomplete(${s.keyword}): ${String(e)}`);
      }
    }

    // 3. Serper per seed → SERP + PAA + related
    let fetched = 0;
    let created = 0;
    let target = 0;
    let watch = 0;
    let park = 0;

    for (const seed of topSeeds) {
      let serp;
      try {
        serp = await serperSearch(seed.keyword);
        fetched++;
      } catch (e) {
        errors.push(`serper(${seed.keyword}): ${String(e)}`);
        continue;
      }

      // ── Score the seed keyword itself ──
      const results: SerpResult[] = serp.organic.slice(0, 10).map((o) => ({
        title: o.title,
        domain: o.domain,
      }));

      const existingGsc = await Keyword.findOne({
        site: site._id,
        keyword: seed.keyword,
      }).lean();

      const breakdown = scoreKeyword(
        {
          gscImpressions: existingGsc?.gscImpressions ?? 0,
          gscPosition: existingGsc?.gscPosition ?? 0,
          autocompleteHits: autocompleteHits.get(seed.keyword.toLowerCase()) ?? 0,
          paas: serp.paas,
        },
        { results },
        heuristicFit(seed.keyword),
      );

      if (!dry) {
        await Keyword.findOneAndUpdate(
          { site: site._id, keyword: seed.keyword },
          {
            $set: {
              source: seed.source === "gsc" ? "gsc" : "serper",
              demand: breakdown.demand,
              serpOpp: breakdown.serpOpp,
              fit: breakdown.fit,
              opportunityScore: breakdown.opportunityScore,
              decision: breakdown.decision,
              overrideReason: breakdown.overrideReason,
              giantsInTop10: breakdown.giantsInTop10,
              weakSitesInTop10: breakdown.weakSitesInTop10,
              topResults: results.slice(0, 10),
              paas: serp.paas,
              related: serp.related,
              lastScoredAt: new Date(),
            },
            $setOnInsert: {
              status: "new",
            },
          },
          { upsert: true, new: true },
        );
        created++;
      }

      if (breakdown.decision === "TARGET") target++;
      else if (breakdown.decision === "WATCH") watch++;
      else park++;

      // ── Save PAA + related as new Keyword candidates (source: "paa") ──
      if (!dry) {
        const paas = serp.paas.slice(0, 5);
        for (const q of paas) {
          const k = q.trim();
          if (k.length < 8) continue;
          const exists = await Keyword.findOne({
            site: site._id,
            keyword: k,
          }).lean();
          if (exists) continue;
          await Keyword.create({
            site: site._id,
            keyword: k,
            source: "paa",
            status: "new",
            paas: [q],
          });
        }
      }
    }

    summary.push({
      site: String(site._id),
      seeds: topSeeds.length,
      fetchedSerps: fetched,
      newKeywords: created,
      target,
      watch,
      park,
      errors: errors.slice(0, 10),
    });
  }

  return NextResponse.json({
    ok: true,
    dry,
    limit,
    sites: summary,
  });
}