// app/api/jobs/style-learn/route.ts — learn/refresh a tenant's writing voice
//
// On-demand only (not scheduled). Voice drifts slowly.
//
// Pipeline per site:
//   1. GET tenant posts (same fetch as content-sync)
//   2. computeMetrics on ALL posts (JS, free)
//   3. analyzeVoiceLLM on 30 sampled (most recent) — ~$0.01/site
//   4. mergeVoiceSpec
//   5. Pick 3 anchors (most recent; GSC-based selection is future work)
//   6. Create StyleProfile vN+1 (versioned, one active per site)
//
// Auth: admin session OR x-cron-secret header OR ?key=CRON_SECRET.
// Query: ?site=<siteId> (optional — if absent, learn all active sites).
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getSession } from "@/lib/admin";
import { decrypt } from "@/lib/crypto";
import Site from "@/models/Site";
import StyleProfile from "@/models/StyleProfile";
import {
  computeMetrics,
  analyzeVoiceLLM,
  mergeVoiceSpec,
  type PostForStyle,
} from "@/lib/styleProfile";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: Request): Promise<boolean> {
  try {
    const session = await getSession();
    if (session) return true;
  } catch {
    /* fall through */
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  return (
    url.searchParams.get("key") === secret ||
    req.headers.get("x-cron-secret") === secret
  );
}

// ── Helpers (mirrors content-sync, keeps this route self-contained) ──

type RawTenantPost = {
  title?: string;
  slug?: string;
  content?: string;
  publishedAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
};

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

function stripHtmlSimple(html: string): string {
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

function absUrl(domain: string, slug: string): string {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/blog/${slug}`;
}

function makeExcerpt(html: string, targetWords = 220): string {
  const text = stripHtmlSimple(html);
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const out: string[] = [];
  let count = 0;
  for (const s of sentences) {
    const wc = s.split(/\s+/).filter(Boolean).length;
    if (count + wc > targetWords && out.length > 0) break;
    out.push(s);
    count += wc;
  }
  return out.join(" ");
}

async function fetchTenantPosts(
  site: {
    domain: string;
    publishUrl: string;
    contentResponsePath?: string | null;
  },
  apiKey: string,
): Promise<RawTenantPost[]> {
  const res = await fetch(site.publishUrl, {
    method: "GET",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`GET ${site.publishUrl} → HTTP ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  return resolveArray(json, site.contentResponsePath ?? "");
}

// ── Handler (shared by GET and POST) ──

async function handle(req: Request): Promise<Response> {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const url = new URL(req.url);
  const onlySite = url.searchParams.get("site");

  const siteFilter: Record<string, unknown> = { active: true };
  if (onlySite) siteFilter._id = onlySite;
  const sites = await Site.find(siteFilter);

  const summary: Array<{
    site: string;
    version: number | null;
    learnedFrom: number;
    sampledForLLM: number;
    error?: string;
  }> = [];

  for (const site of sites) {
    try {
      // 1. Decrypt key
      let apiKey: string;
      try {
        apiKey = decrypt(site.publishKey);
      } catch (e) {
        summary.push({
          site: String(site._id),
          version: null,
          learnedFrom: 0,
          sampledForLLM: 0,
          error: `decrypt publishKey: ${String((e as Error)?.message ?? e)}`,
        });
        continue;
      }

      // 2. Fetch all posts
      let rawPosts: RawTenantPost[];
      try {
        rawPosts = await fetchTenantPosts(
          {
            domain: site.domain,
            publishUrl: site.publishUrl,
            contentResponsePath: site.contentResponsePath,
          },
          apiKey,
        );
      } catch (e) {
        summary.push({
          site: String(site._id),
          version: null,
          learnedFrom: 0,
          sampledForLLM: 0,
          error: `fetch tenant: ${String((e as Error)?.message ?? e)}`,
        });
        continue;
      }

      const posts: PostForStyle[] = rawPosts
        .filter((p) => typeof p.slug === "string" && p.slug && p.content)
        .map((p) => ({
          title: String(p.title ?? p.slug),
          url: absUrl(site.domain, String(p.slug)),
          content: String(p.content ?? ""),
        }));

      if (posts.length === 0) {
        summary.push({
          site: String(site._id),
          version: null,
          learnedFrom: 0,
          sampledForLLM: 0,
          error: "no posts with content — run content-sync first, or check contentResponsePath",
        });
        continue;
      }

      // 3. JS metrics on all posts
      const jsMetrics = computeMetrics(posts);

      // 4. Sample 30 most recent for LLM
      //    (GSC-based selection = future enhancement; recent posts are representative)
      const sortedByRecency = [...posts].sort((a, b) => {
        // url is stable; recency is derived from raw post — we re-attach via slug lookup
        const aSlug = a.url.split("/").pop() ?? "";
        const bSlug = b.url.split("/").pop() ?? "";
        const aRaw = rawPosts.find((r) => r.slug === aSlug);
        const bRaw = rawPosts.find((r) => r.slug === bSlug);
        const at = new Date(aRaw?.publishedAt || aRaw?.updatedAt || 0).getTime();
        const bt = new Date(bRaw?.publishedAt || bRaw?.updatedAt || 0).getTime();
        return bt - at;
      });

      const forLLM = sortedByRecency.slice(0, 30);
      const llmAnalysis = await analyzeVoiceLLM(forLLM);

      // 5. Merge
      const merged = mergeVoiceSpec(jsMetrics, llmAnalysis);

      // 6. Anchors: 3 most recent, ~220 words each
      const anchors = sortedByRecency.slice(0, 3).map((p) => ({
        title: p.title,
        url: p.url,
        excerpt: makeExcerpt(p.content),
      }));

      // 7. Version: deactivate old active, create new active
      const newest = await StyleProfile.find({ site: site._id })
        .sort({ version: -1 })
        .limit(1)
        .lean();
      const nextVersion = (newest[0]?.version ?? 0) + 1;

      // Deactivate first to satisfy the partial unique index on (site, isActive:true)
      await StyleProfile.updateMany(
        { site: site._id, isActive: true },
        { $set: { isActive: false } },
      );

      await StyleProfile.create({
        site: site._id,
        version: nextVersion,
        isActive: true,
        voiceSpec: merged,
        fewShotAnchors: anchors,
        learnedFrom: posts.length,
        sampledForLLM: forLLM.length,
        llmModel: process.env.DEEPSEEK_MODEL || "deepseek-flash",
        refreshedAt: new Date(),
        notes:
          "Anchors = 3 most recent posts. GSC-based selection is future work.",
      });

      summary.push({
        site: String(site._id),
        version: nextVersion,
        learnedFrom: posts.length,
        sampledForLLM: forLLM.length,
      });
    } catch (e) {
      summary.push({
        site: String(site._id),
        version: null,
        learnedFrom: 0,
        sampledForLLM: 0,
        error: String((e as Error)?.message ?? e),
      });
    }
  }

  // Convenience for the button: surface first site's result at top level
  const first = summary[0];
  return NextResponse.json({
    ok: true,
    version: first?.version ?? null,
    learnedFrom: first?.learnedFrom ?? 0,
    sampledForLLM: first?.sampledForLLM ?? 0,
    sites: summary,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}