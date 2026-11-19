// lib/cannibalization.ts — pure functions for cannibalization detection
//
// Used in 3 places:
//   (a) keyword-harvest  — before scoring a keyword, does an existing post already target it?
//   (b) brief-generator  — before generating a brief, same check (second gate)
//   (c) publisher        — before POSTing, does the slug already exist on the tenant?
//
// Pure: takes ContentIndex[] as input, no DB calls, no side effects.
// Callers fetch the index once per site per run.
//
// Match rules (user decision Q7):
//   - case-insensitive
//   - whole-word boundaries (not substring)
//   - leading articles ("a", "an", "the") stripped from both sides
//   - exact match on primaryKeyword OR any secondaryKeyword
//   - near-match: Jaccard token overlap >= 0.7

export type ContentIndexEntry = {
  url: string;
  slug: string;
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  pageType: string;
};

export type Match = {
  url: string;
  slug: string;
  title: string;
  matchedKeyword: string;    // which stored keyword matched
  confidence: "exact" | "near";
  pageType: string;
};

// ── Normalization ──

const LEADING_ARTICLE = /^(?:a|an|the)\s+/i;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")       // strip diacritics
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ") // punctuation → space
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING_ARTICLE, "")
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalize(s);
  return n.length ? n.split(" ") : [];
}

// ── Similarity ──

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// True if `sub` appears as a contiguous whole-word run inside `whole`.
// e.g. ("ai resume tailor", "the ai resume tailor tool") → true
//      ("ai resume",      "air resume")               → false
function containsWholeWordRun(subTokens: string[], wholeTokens: string[]): boolean {
  if (subTokens.length === 0 || subTokens.length > wholeTokens.length) return false;
  for (let i = 0; i <= wholeTokens.length - subTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < subTokens.length; j++) {
      if (wholeTokens[i + j] !== subTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

// ── matchKeyword ──

/**
 * Returns the strongest match if `query` is already served by an existing post,
 * or null if this is a genuinely new topic.
 *
 * Match priority: exact primary > exact secondary > near primary > near secondary.
 */
export function matchKeyword(
  query: string,
  index: ContentIndexEntry[],
): Match | null {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return null;

  let best: Match | null = null;

  for (const entry of index) {
    // 1. Exact primary
    const pTokens = tokenize(entry.primaryKeyword);
    if (pTokens.length > 0 && jaccard(qTokens, pTokens) === 1) {
      return {
        url: entry.url,
        slug: entry.slug,
        title: entry.title,
        matchedKeyword: entry.primaryKeyword,
        confidence: "exact",
        pageType: entry.pageType,
      };
    }

    // 2. Exact secondary
    for (const sk of entry.secondaryKeywords) {
      const skTokens = tokenize(sk);
      if (skTokens.length > 0 && jaccard(qTokens, skTokens) === 1) {
        if (!best || best.confidence !== "exact") {
          best = {
            url: entry.url,
            slug: entry.slug,
            title: entry.title,
            matchedKeyword: sk,
            confidence: "exact",
            pageType: entry.pageType,
          };
        }
        break;
      }
    }
    if (best?.confidence === "exact") continue;

    // 3. Query fully contains primary as a whole-word run
    //    ("ai resume tailor tool" contains "ai resume tailor")
    if (pTokens.length > 0 && containsWholeWordRun(pTokens, qTokens)) {
      if (!best) {
        best = {
          url: entry.url,
          slug: entry.slug,
          title: entry.title,
          matchedKeyword: entry.primaryKeyword,
          confidence: "near",
          pageType: entry.pageType,
        };
      }
      continue;
    }

    // 4. Near-match: high Jaccard on primary
    if (pTokens.length > 0 && jaccard(qTokens, pTokens) >= 0.7) {
      if (!best) {
        best = {
          url: entry.url,
          slug: entry.slug,
          title: entry.title,
          matchedKeyword: entry.primaryKeyword,
          confidence: "near",
          pageType: entry.pageType,
        };
      }
    }
  }

  return best;
}

// ── matchSlug ──

/**
 * Publisher safety net — does this exact slug already exist on the tenant?
 * Pure exact match on slug (case-insensitive, trimmed).
 */
export function matchSlug(
  slug: string,
  index: ContentIndexEntry[],
): Match | null {
  const s = slug.trim().toLowerCase();
  if (!s) return null;
  for (const entry of index) {
    if (entry.slug.trim().toLowerCase() === s) {
      return {
        url: entry.url,
        slug: entry.slug,
        title: entry.title,
        matchedKeyword: entry.primaryKeyword,
        confidence: "exact",
        pageType: entry.pageType,
      };
    }
  }
  return null;
}