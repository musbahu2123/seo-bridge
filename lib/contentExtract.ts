// lib/contentExtract.ts — LLM batch classifier for existing posts
//
// Input: a batch of blog posts (title + slug + description + body excerpt + category)
// Output: for each, { slug, primaryKeyword, secondaryKeywords, intent, isComparison, pageType, confidence }
//
// Model: DeepSeek (preferred) via lib/llm. Falls back to Anthropic/OpenAI if no
// DeepSeek key is set. One LLM call per batch of up to 10 posts.
//
// Cost: ~$0.02 to classify ~95 posts once. Incremental re-syncs skip unchanged posts
// (caller checks blogPostUpdatedAt before calling extractBatch).
import { llmComplete, parseJsonLoose } from "@/lib/llm";

export type PostForClassification = {
  slug: string;
  title: string;
  description: string;
  category: string;
  contentExcerpt: string; // first ~600 chars of body, HTML stripped
};

export type ClassifiedPost = {
  slug: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  intent: "commercial" | "informational" | "transactional" | "navigational";
  isComparison: boolean;
  pageType: "blog" | "comparison" | "landing" | "tool";
  confidence: number; // 0-1
};

const SYSTEM_PROMPT = `You are an SEO analyst classifying existing blog posts for a cannibalization-detection system.

For EACH post in the batch, produce a classification that answers: "what is the ONE primary keyword this post is targeting, and what's its intent shape?"

# Rules

## primaryKeyword
- The single search phrase a searcher would type that this post best answers.
- 2-6 words. Lowercase. No quotes. No trailing punctuation.
- Prefer the phrase visible in the TITLE or SLUG when it is a real search phrase.
- Do NOT invent a keyword the post does not target.

## secondaryKeywords
- 2-5 related phrases the same post also satisfies.
- Same casing rules. Empty array is valid if the post is very narrow.

## intent
- "commercial": comparison, review, "best X", "X vs Y", "alternatives to X".
- "transactional": "free X", "download", "template", "tool", "checker", "generator".
- "informational": how-to, guide, "what is", definition, questions.
- "navigational": brand-name searches ("zety login", "resumetailorapp").

## isComparison
- true if the post is "X vs Y", "X alternatives", "best X tools", or a listicle of options.
- false otherwise.

## pageType
- "comparison"  → isComparison is true
- "landing"     → post reads as a sales/tool page (rare in a blog feed)
- "tool"        → post is about a specific tool (checker, calculator, generator)
- "blog"        → everything else

## confidence
- 0.0-1.0. Be honest: 0.9 only when title+slug+body agree on one clear keyword.

# Output
Return ONLY valid JSON. No markdown. No preamble. Schema:
{
  "results": [
    {
      "slug": "exact-slug-from-input",
      "primaryKeyword": "…",
      "secondaryKeywords": ["…"],
      "intent": "commercial|informational|transactional|navigational",
      "isComparison": true,
      "pageType": "blog|comparison|landing|tool",
      "confidence": 0.85
    }
  ]
}
One result per input post, in the same order.`;

export async function extractBatch(
  posts: PostForClassification[],
  opts: { model?: string } = {},
): Promise<{ results: ClassifiedPost[]; error?: string }> {
  if (posts.length === 0) return { results: [] };

  // Keep batches bounded — 10 posts per call is the sweet spot for DeepSeek:
  // ~1000 input tokens per post, ~10s per call, low failure rate.
  const batch = posts.slice(0, 10);

  const userPrompt = `# Batch (${batch.length} posts)

${batch
  .map(
    (p, i) => `## Post ${i + 1}
slug: ${p.slug}
title: ${p.title}
description: ${p.description || "(none)"}
category: ${p.category || "(none)"}
body excerpt:
${p.contentExcerpt}
`,
  )
  .join("\n")}

# Task
Classify each post per the system prompt. Return JSON only.`;

  let raw: string;
  try {
    raw = await llmComplete({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 4000,
      temperature: 0.2, // low: classification, not writing
      jsonMode: true,
    });
  } catch (e) {
    return { results: [], error: `LLM call failed: ${String((e as Error)?.message ?? e)}` };
  }

  let parsed: { results?: ClassifiedPost[] };
  try {
    parsed = parseJsonLoose<{ results?: ClassifiedPost[] }>(raw);
  } catch (e) {
    return { results: [], error: `JSON parse failed: ${String((e as Error)?.message ?? e)}` };
  }

  if (!Array.isArray(parsed.results)) {
    return { results: [], error: "LLM returned no results array" };
  }

  // Validate every result against the input slugs. Anything that doesn't match
  // a real slug is dropped (LLM hallucination guard).
  const slugSet = new Set(batch.map((b) => b.slug));
  const valid: ClassifiedPost[] = [];
  for (const r of parsed.results) {
    if (!r || typeof r.slug !== "string" || !slugSet.has(r.slug)) continue;
    const intent = r.intent;
    const pageType = r.pageType;
    if (
      !["commercial", "informational", "transactional", "navigational"].includes(intent)
    ) {
      continue;
    }
    if (!["blog", "comparison", "landing", "tool"].includes(pageType)) {
      continue;
    }
    valid.push({
      slug: r.slug,
      primaryKeyword: String(r.primaryKeyword || "").toLowerCase().trim(),
      secondaryKeywords: Array.isArray(r.secondaryKeywords)
        ? r.secondaryKeywords.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
        : [],
      intent,
      isComparison: r.isComparison === true,
      pageType,
      confidence:
        typeof r.confidence === "number"
          ? Math.max(0, Math.min(1, r.confidence))
          : 0.5,
    });
  }

  return { results: valid };
}