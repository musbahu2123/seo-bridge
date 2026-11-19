// lib/briefing.ts — shared prompt + parsing for brief-generator AND regenerate.
// Single source of truth: change the prompt here and both routes pick it up.
//
// Composition order in buildUserPrompt:
//   1. Tenant voice block (learned StyleProfile, ~200 tokens)
//   2. Tenant context (name, positioning, competitors, CTA pages, promo)
//   3. Target keyword + SERP evidence
//   4. SERP feature instructions (R5 — conditional)
//   5. YouTube transcript (optional RAG)
//   6. Task + SEO formula reminder

export const VALID_CATEGORIES = [
  "AI Tools",
  "Resume Tips",
  "Cover Letters",
  "Templates",
  "Career Advice",
  "ATS Optimization",
] as const;

export const SYSTEM_PROMPT = `You are an expert SEO content strategist and writer producing COMPLETE, publish-ready articles for a SaaS that sells OUTCOMES (getting interviews, offers, salary raises), not features.

# Non-negotiable rules

## 1. Writing style: NO EM DASHES
NEVER use the em dash character (—). Not once. Replace every instance with a comma, a period, or restructure the sentence. Do not substitute with " - " either. This is a hard rule.

## 2. Outcome-article template (H1 is a PROMISE, not a topic)
Bad: "Follow-up emails after interview"
Good: "The follow-up email that got me 3 offers (template inside)"
Structure in the content HTML:
1. The result up front (first 2-3 sentences)
2. Why most people fail (experience-driven angle)
3. Step-by-step system (numbered H2s)
4. Save-worthy templates/examples
5. Product placement: 1 contextual CTA per ~400 words, MAX 3 total
6. Internal links: 3-5 cluster posts + 1 comparison post

## 3. Branded promo code (when promoCode provided)
Include the promo code EXACTLY ONCE, in the FIRST 25% of the article, as a standalone sentence an AI Overview can lift verbatim.
Example: "Use code INTV25 for 25% off at ResumeTailorApp.com."
Do not bury it mid-paragraph. Do not repeat it. If promoCode is empty, insert this marker exactly: [HUMAN: create a promo code before publishing]

## 4. AEO rules (MANDATORY)
- Every H2 MUST be followed immediately by a 40-60 word direct-answer paragraph.
- Include a "Bottom line" definition box near the top (for definitional queries).
- End with an FAQ section (h3 question, p answer 60-120 words).
- Where the SERP shows tables/lists, use <ul>/<ol>/<table>.

## 5. Disclosed listicle format (only when intent = commercial AND SERP is listicle-heavy)
If top 10 SERP is dominated by listicles:
- Title: "N Best [Category] for [Specific Need]" (N = 5-10)
- Include your tenant as ONE option among peers, disclosed as "our product"
- Genuinely recommend at least one competitor for a specific need
- Comparison table ranks by criteria, NOT by "us = #1"
- Never a pure ad.
If not a listicle SERP, use the standard outcome-article template.

## 6. E-E-A-T guardrails
- Every claim needs a named source or experiential marker.
- Place [HUMAN: add screenshot] or [HUMAN: add first-hand example] markers.
- If a YouTube transcript is provided, extract 2-3 direct quotes, attribute to the creator, link to the video. Do NOT fabricate quotes.

## 7. Category (must match enum exactly)
Interview/negotiation/career → "Career Advice"
ATS/resume mechanics → "ATS Optimization"
Tool/checker/generator → "AI Tools"
Templates → "Templates"
Cover letters → "Cover Letters"
Generic tips → "Resume Tips"

## 8. SEO formula (NON-NEGOTIABLE — every draft is auto-checked against this)
The target keyword MUST appear, EXACTLY, in each of these six places:
1. **Title** (H1 text) — as a contiguous phrase
2. **Slug** — kebab-cased form of the keyword (e.g. "ats resume checker" → "ats-resume-checker")
3. **Meta title** — include the keyword
4. **Meta description** — the FIRST words must be the keyword (start the sentence with it)
5. **First subtitle H2** — the FIRST H2 in the body must START with the keyword
6. **First body sentence** — the FIRST <p> after H1/H2 must START with the keyword

Match rules (validator enforces):
- Case-insensitive
- Whole-word boundaries (not substring)
- Leading articles ("a", "an", "the") ignored

If any of these six placements is missing, the draft is auto-rejected. This is not optional.

## Output format
Return ONLY valid JSON. No markdown fences. No preamble. Schema:
{
  "intent": "commercial|informational|transactional|navigational",
  "title": "outcome-promise H1 (max 70 chars, must contain keyword)",
  "slug": "kebab-case-url (max 60 chars, contains kebab-keyword)",
  "description": "meta description 140-160 chars",
  "metaTitle": "SEO title 50-60 chars",
  "metaDescription": "MUST START with the keyword, 140-160 chars",
  "category": "one of the 6 enum values exactly",
  "readTime": "X min",
  "outline": ["H2 #1", "..."],
  "brief": "2-3 sentence angle",
  "ctaPlan": "which CTA goes where",
  "content": "full article HTML (h2, h3, p, ul, ol, table, strong) — NO <script> tags, NO <h1>. First <p> after first <h2> MUST start with the keyword",
  "faqs": [{"q": "question", "a": "60-120 word answer"}]
}`;

export type BriefSiteInput = {
  name: string;
  domain: string;
  positioning: string;
  competitors: string[];
  ctaPages: string[];
  promoCode: string;
  promoUrl: string;
  /** Pre-rendered voice block from lib/styleProfile.renderVoiceBlock(). Empty = no profile yet. */
  styleBlock?: string;
};

export type BriefKeywordInput = {
  keyword: string;
  topResults: { title: string; domain: string }[];
  paas: string[];
  related: string[];
  gscImpressions: number;
  gscPosition: number;
  intent: string | null;
  /** R5: SERP features detected by Serper (e.g. "featured_snippet:table"). */
  serpFeatures?: string[];
  /** R5: featured snippet type if present ("paragraph"|"list"|"table"|"video"|null). */
  featuredSnippetType?: string | null;
};

export type BriefYoutubeContext = {
  url: string;
  transcript: string;
};

export type ArticlePayload = {
  intent?: string;
  title?: string;
  slug?: string;
  description?: string;
  metaTitle?: string;
  metaDescription?: string;
  category?: string;
  readTime?: string;
  outline?: string[];
  brief?: string;
  ctaPlan?: string;
  content?: string;
  faqs?: { q: string; a: string }[];
};

// ── SERP feature → content instruction mapping (R5) ──

function renderSerpFeatureInstructions(featuredSnippetType: string | null | undefined): string {
  if (!featuredSnippetType) return "";
  const map: Record<string, string> = {
    table:
      "The SERP shows a TABLE featured snippet. Include a comparison <table> in the body where it naturally fits.",
    list:
      "The SERP shows a LIST featured snippet. Include an <ol> or <ul> near the top of the body (within the first 2 H2 sections).",
    paragraph:
      "The SERP shows a paragraph featured snippet. Include a concise 40-60 word direct-answer paragraph immediately under the first H2 (before any exposition).",
    video:
      "The SERP shows video results. Where relevant, reference video content or embed a YouTube context if the transcript is provided. Do not fabricate a video.",
  };
  const instruction = map[featuredSnippetType];
  return instruction ? `\n# SERP feature hint\n${instruction}\n` : "";
}

// ── buildUserPrompt ──

export function buildUserPrompt(
  site: BriefSiteInput,
  keyword: BriefKeywordInput,
  youtubeContext?: BriefYoutubeContext,
): string {
  // 1. Voice block first — shapes everything after it
  let prompt = "";
  if (site.styleBlock && site.styleBlock.trim().length > 0) {
    prompt += `${site.styleBlock}\n\n`;
  }

  // 2. Tenant context
  prompt += `# Tenant
Site: ${site.name} (${site.domain})
Positioning: ${site.positioning || "(not set)"}
Competitors: ${site.competitors.join(", ") || "(none)"}
CTA pages: ${site.ctaPages.join(", ") || "(none yet)"}
Promo code: ${site.promoCode || "(not set — emit the [HUMAN: create promo code] marker)"}
Promo URL: ${site.promoUrl || "(not set)"}

# Target keyword
"${keyword.keyword}"

# SERP evidence
Top 10:
${keyword.topResults.map((r, i) => `${i + 1}. ${r.title || "(no title)"} — ${r.domain}`).join("\n") || "(none)"}

People Also Ask:
${keyword.paas.map((p, i) => `${i + 1}. ${p}`).join("\n") || "(none)"}

Related searches: ${keyword.related.join(", ") || "(none)"}

GSC evidence: ${keyword.gscImpressions} impressions, avg position ${keyword.gscPosition || "n/a"}
`;

  // 3. SERP feature hint (R5)
  prompt += renderSerpFeatureInstructions(keyword.featuredSnippetType);

  // 4. YouTube transcript (optional)
  if (youtubeContext && youtubeContext.transcript && youtubeContext.transcript.trim().length > 0) {
    prompt += `

# YouTube transcript (human-provided, use as RAG evidence)
URL: ${youtubeContext.url || "(not provided)"}
Transcript (verbatim):
---
${youtubeContext.transcript.slice(0, 8000)}
---

INSTRUCTIONS FOR THIS SECTION:
- Extract 2-3 direct, verbatim quotes that strengthen the article.
- Attribute each quote to the video creator and link to the URL above.
- Do NOT fabricate any quote. If the transcript lacks a relevant quote for a section, do not force one.
- Place quotes inline where they support the point, not all in one block.`;
  }

  // 5. Task + formula reminder (fresh in context)
  prompt += `

# Task
Classify intent, then produce the JSON schema per the system prompt. Content must be 1800-3500 words, evidence-driven, and include every AEO rule.

# Reminders before you write
- NO em dashes. Ever.
- The keyword "${keyword.keyword}" MUST appear EXACTLY in: title, slug (kebab), meta title, meta description (at start), first subtitle H2 (at start), first body sentence (at start).
- Every H2 needs a 40-60 word answer paragraph immediately after.
- End with an FAQ section.`;

  return prompt;
}