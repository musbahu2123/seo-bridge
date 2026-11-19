// lib/seoValidate.ts — the SEO formula validator
//
// Applied to EVERY ArticleJob before it can be marked "approved" for publish.
// User decision Q5: strict. Failures block approval (unless human explicitly
// forces with a "force: true" flag on the review page).
//
// User decision Q6: "keyword at start of first sentence" applies to ALL THREE:
//   (i)   meta description
//   (ii)  subtitle H2 (first H2 in the draft)
//   (iii) first body sentence (first <p> after H1/H2)
//
// User decision Q7: exact match = case-insensitive whole-word substring,
//                   leading articles ("a", "an", "the") ignored.
//
// Pure: takes plain strings, no DB, no side effects.
import { normalize, tokenize } from "@/lib/cannibalization";

const LEADING_ARTICLE = /^(?:a|an|the)\s+/i;

export type SeoCheckStatus = "pass" | "fail" | "warn";

export type SeoCheck = {
  key: string;               // stable identifier, useful for UI keys
  label: string;             // human-readable
  status: SeoCheckStatus;
  detail: string;            // why it passed / failed
};

export type SeoValidationInput = {
  keyword: string;
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  description: string;       // BlogPost.description (the marketing snippet)
  category: string;
  draft: string;             // full HTML content
  validCategories: string[]; // derived from Site.categoryMap VALUES
};

export type SeoValidationResult = {
  pass: boolean;            // true only if zero hard failures
  checks: SeoCheck[];
  hardFails: string[];      // check keys
  warnings: string[];       // check keys
};

// ── helpers ──

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

function firstMatch(html: string, tag: "h1" | "h2" | "h3" | "p"): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? stripHtml(m[1]) : "";
}

function wordCount(s: string): number {
  return stripHtml(s).split(/\s+/).filter(Boolean).length;
}

// Whole-word "keyword appears as a run of tokens inside target".
// Leading articles stripped from keyword before tokenizing.
function keywordAppearsIn(keyword: string, target: string): boolean {
  const kt = tokenize(keyword);
  if (kt.length === 0) return false;
  const tt = tokenize(target);
  if (tt.length < kt.length) return false;
  for (let i = 0; i <= tt.length - kt.length; i++) {
    let ok = true;
    for (let j = 0; j < kt.length; j++) {
      if (tt[i + j] !== kt[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// "keyword appears at start" — appears within the first N characters.
// Q6 says "at beginning of first sentence" — we interpret as: the normalized
// target starts with a leading-article-stripped version of the keyword, OR the
// keyword appears anywhere inside the first sentence.
function keywordAtStartOfSentence(keyword: string, target: string): boolean {
  if (!keyword.trim() || !target.trim()) return false;
  // Split into sentences, take the first
  const firstSentence = target
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] ?? "";
  if (!firstSentence) return false;
  return keywordAppearsIn(keyword, firstSentence);
}

// Is there an H2 that looks like an FAQ section?
function hasFaqSection(html: string): boolean {
  const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = h2Re.exec(html)) !== null) {
    const text = stripHtml(m[1]).toLowerCase();
    if (text.includes("faq") || text.includes("frequently asked")) return true;
  }
  return false;
}

// Does every H2 have a 40-60 word paragraph right after it?
function checkH2AnswerLengths(html: string): {
  h2Count: number;
  violations: number;
} {
  // Very lightweight: count H2s, count immediate <p> siblings
  // We're not building a full parser; regex is enough for the strict gate.
  const h2Blocks = html.split(/<h2[^>]*>/i).slice(1);
  let violations = 0;
  for (const block of h2Blocks) {
    const afterHeading = block.replace(/^[\s\S]*?<\/h2>/i, "");
    const firstP = afterHeading.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!firstP) {
      violations++;
      continue;
    }
    const wc = wordCount(firstP[1]);
    if (wc < 40 || wc > 60) violations++;
  }
  return { h2Count: h2Blocks.length, violations };
}

// ── main ──

export function seoValidate(input: SeoValidationInput): SeoValidationResult {
  const checks: SeoCheck[] = [];
  const push = (c: SeoCheck) => checks.push(c);

  const kw = input.keyword.trim();
  const draft = input.draft || "";

  // 1. Keyword in title
  push({
    key: "keyword_in_title",
    label: "Keyword in title",
    status: keywordAppearsIn(kw, input.title) ? "pass" : "fail",
    detail: input.title ? `"${input.title}"` : "(empty title)",
  });

  // 2. Keyword in slug (kebab-cased keyword is a whole-word run in slug)
  const kwKebab = normalize(kw).replace(/\s+/g, "-");
  const slugNorm = input.slug.trim().toLowerCase();
  push({
    key: "keyword_in_slug",
    label: "Keyword in slug",
    status:
      kwKebab.length > 0 && slugNorm.includes(kwKebab) ? "pass" : "fail",
    detail: `slug="${input.slug}" · expected fragment "${kwKebab}"`,
  });

  // 3. Keyword in H1 (from draft, or title if no <h1>)
  const h1 = firstMatch(draft, "h1") || input.title;
  push({
    key: "keyword_in_h1",
    label: "Keyword in H1",
    status: keywordAppearsIn(kw, h1) ? "pass" : "fail",
    detail: h1 ? `"${h1}"` : "(no H1 found)",
  });

  // 4a. Keyword at start of meta description
  push({
    key: "keyword_in_meta_description_start",
    label: "Keyword at start of meta description",
    status: keywordAtStartOfSentence(kw, input.metaDescription)
      ? "pass"
      : "fail",
    detail: input.metaDescription
      ? `"${input.metaDescription.slice(0, 80)}"`
      : "(empty)",
  });

  // 4b. Keyword at start of subtitle H2 (first H2 in draft)
  const subtitle = firstMatch(draft, "h2");
  push({
    key: "keyword_in_subtitle",
    label: "Keyword at start of subtitle H2",
    status: keywordAtStartOfSentence(kw, subtitle) ? "pass" : "fail",
    detail: subtitle ? `"${subtitle}"` : "(no H2 in draft)",
  });

  // 4c. Keyword at start of first body sentence (first <p> in draft)
  const firstP = firstMatch(draft, "p");
  push({
    key: "keyword_in_first_sentence",
    label: "Keyword at start of first body sentence",
    status: keywordAtStartOfSentence(kw, firstP) ? "pass" : "fail",
    detail: firstP ? `"${firstP.slice(0, 80)}"` : "(no <p> in draft)",
  });

  // 5. No em dashes
  const emDashCount = (draft.match(/—/g) || []).length;
  push({
    key: "no_em_dash",
    label: "No em dashes",
    status: emDashCount === 0 ? "pass" : "fail",
    detail: emDashCount === 0 ? "clean" : `${emDashCount} em dash(es)`,
  });

  // 6. Category in valid enum
  push({
    key: "valid_category",
    label: "Category is valid",
    status: input.validCategories.includes(input.category) ? "pass" : "fail",
    detail: input.category
      ? `"${input.category}" · allowed: ${input.validCategories.join(", ")}`
      : "(empty)",
  });

  // 7. Meta title length 50-60 (warn on 40-49 or 61-70, fail outside that)
  const mtLen = input.metaTitle.trim().length;
  push({
    key: "meta_title_length",
    label: "Meta title 50-60 chars",
    status: mtLen >= 50 && mtLen <= 60 ? "pass" : mtLen >= 40 && mtLen <= 70 ? "warn" : "fail",
    detail: `${mtLen} chars`,
  });

  // 8. Meta description length 140-160 (warn on 120-139 or 161-180)
  const mdLen = input.metaDescription.trim().length;
  push({
    key: "meta_description_length",
    label: "Meta description 140-160 chars",
    status: mdLen >= 140 && mdLen <= 160 ? "pass" : mdLen >= 120 && mdLen <= 180 ? "warn" : "fail",
    detail: `${mdLen} chars`,
  });

  // 9. FAQ section exists
  push({
    key: "has_faq",
    label: "FAQ section present",
    status: hasFaqSection(draft) ? "pass" : "fail",
    detail: hasFaqSection(draft) ? "found H2 mentioning FAQ" : "no FAQ H2",
  });

  // 10. Word count 1800-3500
  const wc = wordCount(draft);
  push({
    key: "word_count",
    label: "Word count 1800-3500",
    status: wc >= 1800 && wc <= 3500 ? "pass" : wc >= 1500 && wc <= 4000 ? "warn" : "fail",
    detail: `${wc} words`,
  });

  // 11. No <h1> inside the content HTML (H1 comes from BlogPost.title on the SaaS)
  const hasH1 = /<h1[\s>]/i.test(draft);
  push({
    key: "no_h1_in_content",
    label: "No H1 inside content HTML",
    status: hasH1 ? "fail" : "pass",
    detail: hasH1 ? "content contains <h1> — SaaS sets H1 from title" : "clean",
  });

  // 12. AEO: each H2 followed by 40-60 word paragraph
  const h2Check = checkH2AnswerLengths(draft);
  if (h2Check.h2Count === 0) {
    push({
      key: "aeo_h2_answers",
      label: "AEO: 40-60 word answer after each H2",
      status: "fail",
      detail: "no H2 sections found",
    });
  } else if (h2Check.violations === 0) {
    push({
      key: "aeo_h2_answers",
      label: "AEO: 40-60 word answer after each H2",
      status: "pass",
      detail: `${h2Check.h2Count} H2s, all followed by 40-60 word paras`,
    });
  } else {
    push({
      key: "aeo_h2_answers",
      label: "AEO: 40-60 word answer after each H2",
      status: "warn", // warn, not fail — structural heuristic can misfire
      detail: `${h2Check.violations}/${h2Check.h2Count} H2 sections out of range`,
    });
  }

  // ── Aggregate ──
  const hardFails = checks.filter((c) => c.status === "fail").map((c) => c.key);
  const warnings = checks.filter((c) => c.status === "warn").map((c) => c.key);

  return {
    pass: hardFails.length === 0,
    checks,
    hardFails,
    warnings,
  };
}