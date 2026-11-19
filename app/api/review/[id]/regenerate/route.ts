// app/api/review/[id]/regenerate/route.ts — regenerate an ArticleJob's draft
//
// Different from brief-generator:
//   - No cannibalization gate (job already vetted)
//   - No landing gate (job already vetted)
//   - Does NOT auto-reject on SEO failure — human iterates
//   - Runs the same SEO validator so the checklist reflects the new draft
//
// Preserves slug (never break URLs on regen).
// Resets status to "awaiting_review" if it was approved.
// Refuses to regenerate jobs already pushed.
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getSession } from "@/lib/admin";
import ArticleJob from "@/models/ArticleJob";
import Keyword from "@/models/Keyword";
import Site from "@/models/Site";
import StyleProfile from "@/models/StyleProfile";
import { llmComplete, parseJsonLoose } from "@/lib/llm";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  VALID_CATEGORIES,
  type ArticlePayload,
} from "@/lib/briefing";
import { seoValidate } from "@/lib/seoValidate";
import {
  renderVoiceBlock,
  type VoiceSpec,
  type FewShotAnchor,
} from "@/lib/styleProfile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function pickValidCategory(cat: string | undefined, fallback: string): string {
  if (cat && (VALID_CATEGORIES as readonly string[]).includes(cat)) return cat;
  if (fallback && (VALID_CATEGORIES as readonly string[]).includes(fallback)) return fallback;
  return "Career Advice";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    youtubeUrl?: string;
    youtubeTranscript?: string;
  };

  const job = await ArticleJob.findById(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status === "pushed") {
    return NextResponse.json(
      { error: "Job is already published. Regeneration would create a duplicate on the SaaS." },
      { status: 400 },
    );
  }

  const keyword = await Keyword.findById(job.keywordId).lean();
  if (!keyword) {
    return NextResponse.json({ error: "Source keyword not found" }, { status: 404 });
  }

  const site = await Site.findById(job.site).lean();
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // ── Load active StyleProfile (regen must match voice too) ──
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

  const youtubeUrl = (body.youtubeUrl ?? job.youtubeUrl ?? "").trim();
  const youtubeTranscript = (body.youtubeTranscript ?? job.youtubeTranscript ?? "").trim();

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
      keyword: keyword.keyword,
      topResults: keyword.topResults ?? [],
      paas: keyword.paas ?? [],
      related: keyword.related ?? [],
      gscImpressions: keyword.gscImpressions ?? 0,
      gscPosition: keyword.gscPosition ?? 0,
      intent: keyword.intent ?? null,
      serpFeatures: keyword.serpFeatures ?? [],
      featuredSnippetType: keyword.featuredSnippetType ?? null,
    },
    youtubeTranscript
      ? { url: youtubeUrl, transcript: youtubeTranscript }
      : undefined,
  );

  let parsed: ArticlePayload;
  try {
    const raw = await llmComplete({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 8000,
      temperature: 0.7,
      jsonMode: true,
    });
    parsed = parseJsonLoose<ArticlePayload>(raw);
  } catch (e) {
    return NextResponse.json(
      { error: `LLM failed: ${String((e as Error)?.message ?? e)}` },
      { status: 502 },
    );
  }

  const category = pickValidCategory(parsed.category, job.category ?? "Career Advice");

  const noteTimestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const notePrefix = youtubeTranscript
    ? `[REGENERATED WITH YOUTUBE ${noteTimestamp}]`
    : `[REGENERATED ${noteTimestamp}]`;

  // Preserve slug (never break URLs on regen). Accept new everything else.
  const nextDraft = parsed.content ?? job.draft;
  const nextTitle = parsed.title ?? job.title;
  const nextMetaTitle = parsed.metaTitle ?? job.metaTitle;
  const nextMetaDescription = parsed.metaDescription ?? job.metaDescription;
  const nextDescription = parsed.description ?? job.description;

  // ── Re-validate against the NEW draft (does not block, just persists) ──
  const validation = seoValidate({
    keyword: keyword.keyword,
    title: nextTitle,
    slug: job.slug, // preserved
    metaTitle: nextMetaTitle,
    metaDescription: nextMetaDescription,
    description: nextDescription,
    category,
    draft: nextDraft,
    validCategories: [...VALID_CATEGORIES],
  });

  job.title = nextTitle;
  job.description = nextDescription;
  job.metaTitle = nextMetaTitle;
  job.metaDescription = nextMetaDescription;
  job.category = category;
  job.readTime = parsed.readTime ?? job.readTime;
  job.brief = parsed.brief ?? job.brief;
  job.outline = parsed.outline ?? job.outline;
  job.ctaPlan = parsed.ctaPlan ?? job.ctaPlan;
  job.draft = nextDraft;
  job.faqs = parsed.faqs ?? job.faqs;
  job.youtubeUrl = youtubeUrl;
  job.youtubeTranscript = youtubeTranscript;
  job.seoValidation = {
    pass: validation.pass,
    hardFails: validation.hardFails,
    warnings: validation.warnings,
    checks: validation.checks,
    validatedAt: new Date(),
  };
  job.status = "awaiting_review";
  job.reviewNotes = `${notePrefix} ${job.reviewNotes || ""}`.trim();

  await job.save();

  if (parsed.intent && !keyword.intent) {
    await Keyword.findByIdAndUpdate(job.keywordId, {
      $set: { intent: parsed.intent },
    });
  }

  return NextResponse.json({
    ok: true,
    job: {
      _id: String(job._id),
      title: job.title,
      draft: job.draft,
      status: job.status,
      hasYoutube: !!job.youtubeTranscript,
      seoPass: validation.pass,
      seoFails: validation.hardFails,
    },
  });
}