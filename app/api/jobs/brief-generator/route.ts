// app/api/jobs/brief-generator/route.ts — full pipeline with gates
//
// Order of operations per keyword:
//   1. Cannibalization gate  (ContentIndex + matchKeyword)
//   2. Landing-shape gate    (pre-LLM heuristic → LandingTodo, skip LLM)
//   3. Voice injection       (active StyleProfile → styleBlock)
//   4. LLM call              (with serpFeatures + style + formula reminder)
//   5. SEO formula validation (seoValidate)
//   6. Retry once if failed   (inject failure reasons)
//   7. Persist ArticleJob    (status=awaiting_review if pass, rejected if not)
//
// Auth: ?key=CRON_SECRET or x-cron-secret header.
// Query: ?site=<id>  ?limit=<n> (default 2, max 5)
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
import Keyword from "@/models/Keyword";
import ArticleJob from "@/models/ArticleJob";
import ContentIndex from "@/models/ContentIndex";
import StyleProfile from "@/models/StyleProfile";
import LandingTodo from "@/models/LandingTodo";
import { llmComplete, parseJsonLoose } from "@/lib/llm";
import { markJobFinished, scheduleContinuation } from "@/lib/schedule";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  VALID_CATEGORIES,
  type ArticlePayload,
} from "@/lib/briefing";
import { matchKeyword, type ContentIndexEntry } from "@/lib/cannibalization";
import { seoValidate, type SeoValidationResult } from "@/lib/seoValidate";
import {
  renderVoiceBlock,
  type VoiceSpec,
  type FewShotAnchor,
} from "@/lib/styleProfile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  return (
    url.searchParams.get("key") === secret ||
    req.headers.get("x-cron-secret") === secret
  );
}

function pickValidCategory(cat: string | undefined): string {
  if (cat && (VALID_CATEGORIES as readonly string[]).includes(cat)) return cat;
  return "Career Advice";
}

function fallbackSlug(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// Landing-shape heuristic (pre-LLM). Cheap, deterministic, no LLM tokens.
const TOOL_NOUNS = /\b(checker|calculator|generator|builder|scanner|analyzer|template maker)\b/i;
const COMPARISON = /\b(best|top|vs|versus|alternatives?|review|compare)\b/i;
const QUESTION_START = /^(how|what|why|when|where|who|is|are|can|should|do|does|did)\b/i;

function isLandingShaped(keyword: string): { shaped: boolean; reason: string } {
  const k = keyword.toLowerCase().trim();
  if (QUESTION_START.test(k)) return { shaped: false, reason: "" };
  if (COMPARISON.test(k)) return { shaped: false, reason: "" };
  if (TOOL_NOUNS.test(k)) {
    return { shaped: true, reason: "keyword contains tool noun (checker/calculator/builder/etc.)" };
  }
  return { shaped: false, reason: "" };
}

function formatFailuresForRetry(validation: SeoValidationResult): string {
  const fails = validation.checks.filter((c) => c.status === "fail");
  return `# FIX THESE FAILURES (retry)

The previous response failed these auto-checks. Rewrite the ENTIRE response (same JSON schema) with these fixed:

${fails.map((c, i) => `${i + 1}. ${c.key} — ${c.label}. Current detail: ${c.detail}`).join("\n")}

Return the complete corrected JSON. Do not skip fields. Do not explain — just output the JSON.`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await dbConnect();

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 2), 5));
  const onlySite = url.searchParams.get("site");

  const siteFilter: Record<string, unknown> = { active: true };
  if (onlySite) siteFilter._id = onlySite;
  const sites = await Site.find(siteFilter);

  const results: Array<{
    site: string;
    generated: number;
    rejectedCannibalization: number;
    rejectedLanding: number;
    rejectedSeo: number;
    errors: string[];
  }> = [];

  for (const site of sites) {
    const errors: string[] = [];
    let generated = 0;
    let rejectedCannibalization = 0;
    let rejectedLanding = 0;
    let rejectedSeo = 0;

    // ── Load ContentIndex once (cache for all keywords in this site) ──
    const contentIndexDocs = await ContentIndex.find({ site: site._id }).lean();
    const contentIndex: ContentIndexEntry[] = contentIndexDocs.map((d) => ({
      url: d.url,
      slug: d.slug,
      title: d.title,
      primaryKeyword: d.primaryKeyword ?? "",
      secondaryKeywords: d.secondaryKeywords ?? [],
      pageType: d.pageType ?? "blog",
    }));

    // ── Load active StyleProfile once ──
    const styleProfile = await StyleProfile.findOne({
      site: site._id,
      isActive: true,
    }).lean();
    const styleBlock = styleProfile
      ? renderVoiceBlock(
          styleProfile.voiceSpec as VoiceSpec,
          (styleProfile.fewShotAnchors ?? []) as FewShotAnchor[],
        )
      : "";

    // ── Fetch approved keywords ──
    const keywords = await Keyword.find({ site: site._id, status: "approved" })
      .sort({ opportunityScore: -1 })
      .limit(limit)
      .lean();

    for (const kw of keywords) {
      try {
        // ── Gate 1: Cannibalization ──
        const cannibalized = matchKeyword(kw.keyword, contentIndex);
        if (cannibalized) {
          await Keyword.findByIdAndUpdate(kw._id, {
            $set: {
              status: "watch",
              decision: "PARK",
              overrideReason: `Duplicate of ${cannibalized.url} (${cannibalized.confidence} match on "${cannibalized.matchedKeyword}")`,
              cannibalizedBy: {
                url: cannibalized.url,
                slug: cannibalized.slug,
                title: cannibalized.title,
                matchedKeyword: cannibalized.matchedKeyword,
                confidence: cannibalized.confidence,
              },
            },
          });
          rejectedCannibalization++;
          errors.push(`${kw.keyword}: cannibalized by ${cannibalized.url}`);
          continue;
        }

        // ── Gate 2: Landing-shape (pre-LLM, cheap) ──
        const landing = isLandingShaped(kw.keyword);
        if (landing.shaped) {
          await LandingTodo.findOneAndUpdate(
            { site: site._id, keyword: kw.keyword },
            {
              $setOnInsert: {
                site: site._id,
                keyword: kw.keyword,
                keywordId: kw._id,
                suggestedSlug: fallbackSlug(kw.keyword),
                reason: landing.reason,
                status: "new",
              },
            },
            { upsert: true },
          );
          await Keyword.findByIdAndUpdate(kw._id, {
            $set: {
              status: "rejected",
              notes: "Landing-page shape — see LandingTodo (R3 flag-only)",
            },
          });
          rejectedLanding++;
          errors.push(`${kw.keyword}: landing-shaped (${landing.reason})`);
          continue;
        }

        // ── Build prompt with voice + SERP features ──
        const userPrompt = buildUserPrompt(
          {
            name: site.name,
            domain: site.domain,
            positioning: site.positioning ?? "",
            competitors: site.competitors ?? [],
            ctaPages: site.ctaPages ?? [],
            promoCode: site.promoCode ?? "",
            promoUrl: site.promoUrl ?? "",
            styleBlock,
          },
          {
            keyword: kw.keyword,
            topResults: kw.topResults ?? [],
            paas: kw.paas ?? [],
            related: kw.related ?? [],
            gscImpressions: kw.gscImpressions ?? 0,
            gscPosition: kw.gscPosition ?? 0,
            intent: kw.intent ?? null,
            serpFeatures: kw.serpFeatures ?? [],
            featuredSnippetType: kw.featuredSnippetType ?? null,
          },
        );

        // ── LLM call 1 ──
        const raw = await llmComplete({
          system: SYSTEM_PROMPT,
          user: userPrompt,
          maxTokens: 8000,
          temperature: 0.7,
          jsonMode: true,
        });
        let parsed = parseJsonLoose<ArticlePayload>(raw);

        // ── Validate ──
        const fSlug = parsed.slug ?? fallbackSlug(kw.keyword);
        let category = pickValidCategory(parsed.category);

        let validation = seoValidate({
          keyword: kw.keyword,
          title: parsed.title ?? "",
          slug: fSlug,
          metaTitle: parsed.metaTitle ?? "",
          metaDescription: parsed.metaDescription ?? "",
          description: parsed.description ?? "",
          category,
          draft: parsed.content ?? "",
          validCategories: [...VALID_CATEGORIES],
        });

        // ── Retry once if failed (accept if strictly better) ──
        if (!validation.pass) {
          try {
            const retryPrompt = userPrompt + "\n\n" + formatFailuresForRetry(validation);
            const retryRaw = await llmComplete({
              system: SYSTEM_PROMPT,
              user: retryPrompt,
              maxTokens: 8000,
              temperature: 0.4,
              jsonMode: true,
            });
            const retryParsed = parseJsonLoose<ArticlePayload>(retryRaw);
            const retrySlug = retryParsed.slug ?? fallbackSlug(kw.keyword);
            const retryCategory = pickValidCategory(retryParsed.category);
            const retryValidation = seoValidate({
              keyword: kw.keyword,
              title: retryParsed.title ?? "",
              slug: retrySlug,
              metaTitle: retryParsed.metaTitle ?? "",
              metaDescription: retryParsed.metaDescription ?? "",
              description: retryParsed.description ?? "",
              category: retryCategory,
              draft: retryParsed.content ?? "",
              validCategories: [...VALID_CATEGORIES],
            });
            if (retryValidation.hardFails.length < validation.hardFails.length) {
              parsed = retryParsed;
              validation = retryValidation;
              category = retryCategory;
            }
          } catch (retryErr) {
            errors.push(
              `${kw.keyword}: retry failed: ${String((retryErr as Error)?.message ?? retryErr)}`,
            );
          }
        }

        const finalSlug = parsed.slug ?? fallbackSlug(kw.keyword);
        const finalCategory = pickValidCategory(parsed.category);

        // ── Persist ArticleJob with validation ──
        await ArticleJob.create({
          keywordId: kw._id,
          site: site._id,
          brief: parsed.brief ?? "",
          outline: parsed.outline ?? [],
          ctaPlan: parsed.ctaPlan ?? "",
          draft: parsed.content ?? "",
          faqs: parsed.faqs ?? [],
          title: parsed.title ?? kw.keyword,
          slug: finalSlug,
          description: parsed.description ?? "",
          metaTitle: parsed.metaTitle ?? "",
          metaDescription: parsed.metaDescription ?? "",
          category: finalCategory,
          readTime: parsed.readTime ?? "6 min",
          image: "/images/blog/default.jpg",
          seoValidation: {
            pass: validation.pass,
            hardFails: validation.hardFails,
            warnings: validation.warnings,
            checks: validation.checks,
            validatedAt: new Date(),
          },
          status: validation.pass ? "awaiting_review" : "rejected",
          reviewNotes: validation.pass
            ? ""
            : `Auto-rejected on SEO formula after retry: ${validation.hardFails.join(", ")}`,
        });

        await Keyword.findByIdAndUpdate(kw._id, {
          $set: {
            status: validation.pass ? "briefed" : "rejected",
            intent: parsed.intent ?? kw.intent,
          },
        });

        if (validation.pass) {
          generated++;
        } else {
          rejectedSeo++;
          errors.push(
            `${kw.keyword}: SEO formula failed after retry (${validation.hardFails.join(", ")})`,
          );
        }
      } catch (e) {
        errors.push(`${kw.keyword}: ${String((e as Error)?.message ?? e)}`);
      }
    }

    results.push({
      site: String(site._id),
      generated,
      rejectedCannibalization,
      rejectedLanding,
      rejectedSeo,
      errors,
    });

    const remaining = await Keyword.countDocuments({
      site: site._id,
      status: "approved",
    });
    if (remaining > 0) {
      await scheduleContinuation("brief-generator", {
        site: String(site._id),
        limit: String(limit),
      });
    }
  }

  await markJobFinished(
    "brief-generator",
    true,
    `generated ${results.reduce((a, r) => a + r.generated, 0)}`,
  );

  return NextResponse.json({ ok: true, results });
}