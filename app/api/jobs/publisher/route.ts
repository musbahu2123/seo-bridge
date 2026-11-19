// app/api/jobs/publisher/route.ts — daily publisher with safety gates
//
// For each site with approved jobs:
//   1. Live GET tenant (once per site) → list of {slug, url, title}
//   2. For each job, in order:
//      a. seoValidation.pass === false AND !forceOverride → refuse (422)
//      b. landingFlag.flagged === true                  → refuse (422)
//      c. matchSlug(job.slug, tenantPosts)             → refuse (409)
//      d. POST payload to tenant                       → log postId, mark pushed
//
// Refusals do NOT change job status. Human resolves in review UI:
//   - SEO fail  → regenerate or edit draft
//   - Landing   → create the landing page manually, dismiss flag
//   - Slug dup  → rename slug in the review UI, retry
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { decrypt } from "@/lib/crypto";
import ArticleJob from "@/models/ArticleJob";
import Site from "@/models/Site";
import Keyword from "@/models/Keyword";
import PageIndex from "@/models/PageIndex";
import { pingIndexNow } from "@/lib/indexnow";
import { matchSlug, type ContentIndexEntry } from "@/lib/cannibalization";

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

type RawTenantPost = { slug?: string; title?: string; [k: string]: unknown };

function resolveArray(json: unknown, path: string): RawTenantPost[] {
  if (!path) return Array.isArray(json) ? (json as RawTenantPost[]) : [];
  let cur: unknown = json;
  for (const k of path.split(".")) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return [];
    }
  }
  return Array.isArray(cur) ? (cur as RawTenantPost[]) : [];
}

function absUrl(domain: string, slug: string): string {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/blog/${slug}`;
}

async function fetchTenantPosts(
  site: {
    domain: string;
    publishUrl: string;
    contentResponsePath?: string | null;
  },
  apiKey: string,
): Promise<ContentIndexEntry[]> {
  const res = await fetch(site.publishUrl, {
    method: "GET",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`GET ${site.publishUrl} → HTTP ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  const arr = resolveArray(json, site.contentResponsePath ?? "");
  return arr
    .filter((p) => typeof p.slug === "string" && p.slug)
    .map((p) => ({
      url: absUrl(site.domain, String(p.slug)),
      slug: String(p.slug),
      title: String(p.title ?? ""),
      primaryKeyword: "",
      secondaryKeywords: [],
      pageType: "blog",
    }));
}

type Refusal = {
  job: string;
  ok: false;
  refused: true;
  code: "SEO_FAIL" | "LANDING_FLAG" | "SLUG_DUP";
  error: string;
  detail?: unknown;
};

type Success = {
  job: string;
  ok: true;
  publishedUrl: string;
};

type Failure = {
  job: string;
  ok: false;
  refused?: false;
  error: string;
};

type Result = Refusal | Success | Failure;

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await dbConnect();

  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(Number(url.searchParams.get("limit") ?? 10), 30),
  );

  const jobs = await ArticleJob.find({ status: "approved" })
    .sort({ createdAt: 1 })
    .limit(limit);

  // Group jobs by site to do one tenant GET per site
  const bySite = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const key = String(j.site);
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key)!.push(j);
  }

  const results: Result[] = [];

  for (const [siteId, siteJobs] of bySite) {
    const site = await Site.findById(siteId);
    if (!site) {
      for (const j of siteJobs) {
        results.push({ job: String(j._id), ok: false, error: "Site not found" });
      }
      continue;
    }

    let apiKey: string;
    try {
      apiKey = decrypt(site.publishKey);
    } catch (e) {
      for (const j of siteJobs) {
        results.push({
          job: String(j._id),
          ok: false,
          error: `Could not decrypt publishKey: ${String((e as Error)?.message ?? e)}`,
        });
      }
      continue;
    }

    // Live tenant posts — one GET per site
    let tenantPosts: ContentIndexEntry[];
    try {
      tenantPosts = await fetchTenantPosts(
        {
          domain: site.domain,
          publishUrl: site.publishUrl,
          contentResponsePath: site.contentResponsePath,
        },
        apiKey,
      );
    } catch (e) {
      for (const j of siteJobs) {
        results.push({
          job: String(j._id),
          ok: false,
          error: `Live slug check failed: ${String((e as Error)?.message ?? e)}`,
        });
      }
      continue;
    }

    for (const job of siteJobs) {
      try {
        // ── Gate 1: SEO formula ──
        const seoPass = job.seoValidation?.pass !== false; // undefined/null = legacy = allow
        const seoOverride = job.seoValidation?.forceOverride === true;
        if (!seoPass && !seoOverride) {
          results.push({
            job: String(job._id),
            ok: false,
            refused: true,
            code: "SEO_FAIL",
            error: `SEO formula failed (${job.seoValidation?.hardFails.join(", ") ?? "unknown"}). Regenerate or edit draft, or force-override if you accept the risk.`,
            detail: job.seoValidation?.checks ?? [],
          });
          continue;
        }

        // ── Gate 2: Landing flag ──
        if (job.landingFlag?.flagged === true) {
          results.push({
            job: String(job._id),
            ok: false,
            refused: true,
            code: "LANDING_FLAG",
            error: `Job is flagged for landing page: ${job.landingFlag.reason || "(no reason)"}. Handle manually in the SaaS, then unflag.`,
          });
          continue;
        }

        // ── Gate 3: Slug dup ──
        const dup = matchSlug(job.slug, tenantPosts);
        if (dup) {
          results.push({
            job: String(job._id),
            ok: false,
            refused: true,
            code: "SLUG_DUP",
            error: `Slug "${job.slug}" already exists on tenant: ${dup.url}. Rename slug in review UI.`,
            detail: { existingUrl: dup.url, existingTitle: dup.title },
          });
          continue;
        }

        // ── All gates pass → POST ──
        const payload = {
          title: job.title,
          slug: job.slug,
          description: job.description,
          content: job.draft,
          category: job.category,
          readTime: job.readTime,
          metaTitle: job.metaTitle,
          metaDescription: job.metaDescription,
          image: job.image || "/images/blog/default.jpg",
          author: "Resume Expert",
          status: "published",
        };

        const res = await fetch(site.publishUrl, {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
          const text = await res.text();
          results.push({
            job: String(job._id),
            ok: false,
            error: `SaaS rejected (${res.status}): ${text.slice(0, 200)}`,
          });
          continue;
        }

        const created = (await res.json()) as { _id?: string; slug?: string };
        const publishedUrl = absUrl(site.domain, String(created.slug ?? job.slug));

        job.status = "pushed";
        job.postId = String(created._id ?? "");
        job.publishedUrl = publishedUrl;
        job.pushedAt = new Date();
        await job.save();

        await Keyword.findByIdAndUpdate(job.keywordId, { $set: { status: "published" } });

        await PageIndex.findOneAndUpdate(
          { site: site._id, url: publishedUrl },
          {
            $setOnInsert: {
              site: site._id,
              type: "own",
              url: publishedUrl,
              firstSeen: new Date(),
            },
          },
          { upsert: true },
        );

        const idx = await pingIndexNow(publishedUrl);
        if (idx.ok) {
          await ArticleJob.updateOne(
            { _id: job._id },
            { $set: { indexNowPinged: true } },
          );
        }

        results.push({ job: String(job._id), ok: true, publishedUrl });
      } catch (e) {
        results.push({
          job: String(job._id),
          ok: false,
          error: String((e as Error)?.message ?? e),
        });
      }
    }
  }

  const refused = results.filter(
    (r): r is Refusal => "refused" in r && r.refused === true,
  ).length;
  const succeeded = results.filter(
    (r): r is Success => "publishedUrl" in r,
  ).length;

  return NextResponse.json({
    ok: true,
    summary: {
      total: results.length,
      succeeded,
      refused,
      failed: results.length - succeeded - refused,
    },
    results,
  });
}