// app/api/review/[id]/publish/route.ts — immediate publish for one approved job
//
// Same three gates as the daily publisher (seoValidation, landingFlag, slug dup).
// Same payload shape. Same post-push bookkeeping.
//
// Error codes to the review UI:
//   422 SEO_FAIL    — regenerate or edit the draft
//   422 LANDING_FLAG — handle landing page manually, then unflag
//   409 SLUG_DUP    — rename slug in review UI
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getSession } from "@/lib/admin";
import { decrypt } from "@/lib/crypto";
import ArticleJob from "@/models/ArticleJob";
import Site from "@/models/Site";
import Keyword from "@/models/Keyword";
import PageIndex from "@/models/PageIndex";
import { pingIndexNow } from "@/lib/indexnow";
import { matchSlug, type ContentIndexEntry } from "@/lib/cannibalization";

export const dynamic = "force-dynamic";

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

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();
  const { id } = await params;

  const job = await ArticleJob.findById(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (job.status !== "approved") {
    return NextResponse.json(
      {
        error: `Cannot publish job with status "${job.status}" — approve it first`,
        code: "NOT_APPROVED",
      },
      { status: 400 },
    );
  }

  const site = await Site.findById(job.site);
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  // ── Gate 1: SEO formula ──
  const seoPass = job.seoValidation?.pass !== false;
  const seoOverride = job.seoValidation?.forceOverride === true;
  if (!seoPass && !seoOverride) {
    return NextResponse.json(
      {
        code: "SEO_FAIL",
        error: `SEO formula failed (${job.seoValidation?.hardFails.join(", ") ?? "unknown"}). Regenerate or edit the draft first.`,
        detail: job.seoValidation?.checks ?? [],
      },
      { status: 422 },
    );
  }

  // ── Gate 2: Landing flag ──
  if (job.landingFlag?.flagged === true) {
    return NextResponse.json(
      {
        code: "LANDING_FLAG",
        error: `Job is flagged for landing page: ${job.landingFlag.reason || "(no reason)"}. Handle manually in the SaaS, then unflag.`,
      },
      { status: 422 },
    );
  }

  // ── Decrypt key ──
  let apiKey: string;
  try {
    apiKey = decrypt(site.publishKey);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not decrypt publishKey: ${String((e as Error)?.message ?? e)}` },
      { status: 500 },
    );
  }

  // ── Gate 3: Slug dup (live tenant GET) ──
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
    return NextResponse.json(
      { error: `Live slug check failed: ${String((e as Error)?.message ?? e)}` },
      { status: 502 },
    );
  }

  const dup = matchSlug(job.slug, tenantPosts);
  if (dup) {
    return NextResponse.json(
      {
        code: "SLUG_DUP",
        error: `Slug "${job.slug}" already exists on tenant: ${dup.url}. Rename the slug in the review UI.`,
        detail: { existingUrl: dup.url, existingTitle: dup.title },
      },
      { status: 409 },
    );
  }

  // ── POST ──
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
    return NextResponse.json(
      { error: `SaaS rejected publish (${res.status}): ${text.slice(0, 500)}` },
      { status: 502 },
    );
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
    await ArticleJob.updateOne({ _id: job._id }, { $set: { indexNowPinged: true } });
  }

  return NextResponse.json({
    ok: true,
    publishedUrl,
    postId: job.postId,
    indexNow: idx,
  });
}