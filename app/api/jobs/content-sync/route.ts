// app/api/jobs/content-sync/route.ts — index every post on every tenant
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { decrypt } from "@/lib/crypto";
import Site from "@/models/Site";
import ContentIndex from "@/models/ContentIndex";
import { markJobFinished } from "@/lib/schedule";
import {
  extractBatch,
  type PostForClassification,
} from "@/lib/contentExtract";

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

type RawBlogPost = {
  _id?: string;
  title?: string;
  slug?: string;
  description?: string;
  content?: string;
  category?: string;
  status?: string;
  publishedAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
};

function resolveArray(json: unknown, path: string): RawBlogPost[] {
  if (!path) {
    return Array.isArray(json) ? (json as RawBlogPost[]) : [];
  }
  let cur: unknown = json;
  for (const key of path.split(".")) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return [];
    }
  }
  return Array.isArray(cur) ? (cur as RawBlogPost[]) : [];
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return "";
  return stripHtml(m[1]);
}

function excerptOf(html: string, max = 600): string {
  return stripHtml(html).slice(0, max);
}

function absUrl(domain: string, slug: string): string {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/blog/${slug}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const onlySite = url.searchParams.get("site");
  const limit = Math.max(
    1,
    Math.min(Number(url.searchParams.get("limit") ?? 500), 1000),
  );
  const doClassify = url.searchParams.get("classify") !== "0";

  await dbConnect();

  const siteFilter: Record<string, unknown> = { active: true };
  if (onlySite) siteFilter._id = onlySite;
  const sites = await Site.find(siteFilter);

  const summary: Array<{
    site: string;
    fetched: number;
    upserted: number;
    classified: number;
    skippedUnchanged: number;
    errors: string[];
  }> = [];

  for (const site of sites) {
    const errors: string[] = [];
    let fetched = 0;
    let upserted = 0;
    let classified = 0;
    let skippedUnchanged = 0;

    let apiKey: string;
    try {
      apiKey = decrypt(site.publishKey);
    } catch (e) {
      errors.push(`decrypt publishKey: ${String((e as Error)?.message ?? e)}`);
      summary.push({ site: String(site._id), fetched, upserted, classified, skippedUnchanged, errors });
      continue;
    }

    let rawPosts: RawBlogPost[] = [];
    try {
      const res = await fetch(site.publishUrl, {
        method: "GET",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const json = (await res.json()) as unknown;
      rawPosts = resolveArray(json, site.contentResponsePath || "");
      if (rawPosts.length === 0) {
        const keys =
          json && typeof json === "object" && !Array.isArray(json)
            ? Object.keys(json as Record<string, unknown>).slice(0, 8)
            : [];
        errors.push(
          keys.length
            ? `No posts found. Response top-level keys: [${keys.join(", ")}]. Check Site.contentResponsePath.`
            : "No posts found in tenant response.",
        );
      }
    } catch (e) {
      errors.push(`GET publishUrl: ${String((e as Error)?.message ?? e)}`);
      summary.push({ site: String(site._id), fetched, upserted, classified, skippedUnchanged, errors });
      continue;
    }

    rawPosts = rawPosts.slice(0, limit);
    fetched = rawPosts.length;

    const toClassify: Array<{
      slug: string;
      doc: {
        url: string;
        slug: string;
        title: string;
        h1: string;
        description: string;
        category: string;
        publishedAt: Date | null;
        blogPostUpdatedAt: Date | null;
      };
    }> = [];

    for (const p of rawPosts) {
      const slug = String(p.slug ?? "").trim();
      if (!slug) continue;

      const title = String(p.title ?? "").trim() || slug;
      const description = String(p.description ?? "").trim();
      const category = String(p.category ?? "").trim();
      const content = String(p.content ?? "");
      const h1 = extractH1(content) || title;
      const url = absUrl(site.domain, slug);
      const publishedAt = p.publishedAt ? new Date(p.publishedAt) : null;
      const blogPostUpdatedAt = p.updatedAt ? new Date(p.updatedAt) : null;

      const existing = await ContentIndex.findOne({
        site: site._id,
        url,
      }).lean();

      const unchanged =
        existing &&
        blogPostUpdatedAt &&
        existing.blogPostUpdatedAt &&
        new Date(existing.blogPostUpdatedAt).getTime() ===
          blogPostUpdatedAt.getTime();

      if (unchanged) {
        skippedUnchanged++;
        continue;
      }

      await ContentIndex.findOneAndUpdate(
        { site: site._id, url },
        {
          $set: {
            slug,
            title,
            h1,
            description,
            category,
            publishedAt,
            blogPostUpdatedAt,
            source: "blog-api",
            lastSyncedAt: new Date(),
          },
          $setOnInsert: {
            site: site._id,
            url,
          },
        },
        { upsert: true },
      );
      upserted++;

      if (doClassify && content) {
        toClassify.push({
          slug,
          doc: { url, slug, title, h1, description, category, publishedAt, blogPostUpdatedAt },
        });
      }
    }

    if (toClassify.length > 0) {
      const excerptBySlug = new Map<string, string>();
      for (const p of rawPosts) {
        const slug = String(p.slug ?? "").trim();
        if (!slug) continue;
        excerptBySlug.set(slug, excerptOf(String(p.content ?? "")));
      }

      for (let i = 0; i < toClassify.length; i += 10) {
        const chunk = toClassify.slice(i, i + 10);
        const payload: PostForClassification[] = chunk.map((c) => ({
          slug: c.slug,
          title: c.doc.title,
          description: c.doc.description,
          category: c.doc.category,
          contentExcerpt: excerptBySlug.get(c.slug) ?? "",
        }));

        const { results, error } = await extractBatch(payload);
        if (error) {
          errors.push(`classify batch ${i / 10}: ${error}`);
          continue;
        }
        for (const r of results) {
          const target = chunk.find((c) => c.slug === r.slug);
          if (!target) continue;
          await ContentIndex.updateOne(
            { site: site._id, url: target.doc.url },
            {
              $set: {
                primaryKeyword: r.primaryKeyword,
                secondaryKeywords: r.secondaryKeywords,
                intent: r.intent,
                isComparison: r.isComparison,
                pageType: r.pageType,
                llmConfidence: r.confidence,
                llmModel: process.env.DEEPSEEK_MODEL || "deepseek-flash",
                lastSyncedAt: new Date(),
              },
            },
          );
          classified++;
        }
      }
    }

    summary.push({
      site: String(site._id),
      fetched,
      upserted,
      classified,
      skippedUnchanged,
      errors: errors.slice(0, 10),
    });
  }

  await markJobFinished(
    "content-sync",
    true,
    `${summary.reduce((a, s) => a + s.upserted, 0)} upserted, ${summary.reduce((a, s) => a + s.classified, 0)} classified`,
  );
  return NextResponse.json({ ok: true, sites: summary });
}