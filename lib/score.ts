// lib/score.ts — the Opportunity Score engine (brief §3.5)
//
// Opportunity Score (0-10) = Demand (0-3) + SERP Opportunity (0-4) + Fit (0-3)
//
// Decision: >= 7 TARGET · 4-6 WATCH · < 4 PARK
//
// Hard overrides (beat the score):
//   - >= 3 giants in top 10            → PARK
//   - exact-match page exists          → OPTIMIZE_EXISTING (returns via signal)
//   - Outrank is already targeting it  → SKIP (dedupe)
//
// "Giants" = the big-brand list from the brief. Kept as an exported constant
// so it's easy to tune without touching the scoring logic.

export const GIANTS: string[] = [
  "zety.com",
  "indeed.com",
  "linkedin.com",
  "canva.com",
  "microsoft.com",
  "forbes.com",
  "resumegenius.com",
  "novoresume.com",
  "resume.io",
  "tealhq.com",
  "glassdoor.com",
  "monster.com",
  "careerbuilder.com",
  "ziprecruiter.com",
  "themuse.com",
  "thebalancemoney.com",
  "businessinsider.com",
];

// Domains whose presence is a POSITIVE signal (community / forum / small
// platforms we can realistically outrank or that show Google is mixing in
// non-commercial results).
const COMMUNITY_DOMAINS = [
  "reddit.com",
  "quora.com",
  "medium.com",
  "stackexchange.com",
  "stackoverflow.com",
  "news.ycombinator.com",
  "facebook.com", // groups often show for niche queries
];

export type SerpResult = { title: string; domain: string };

export type DemandInput = {
  gscImpressions: number; // last 28d
  gscPosition: number; // avg position (0 = unknown)
  autocompleteHits: number; // times it appeared across seed expansions
  paas: string[]; // People Also Ask list from Serper
};

export type SerpOppInput = {
  results: SerpResult[]; // top 10 organic
};

export type FitInput = {
  // pre-classified by the batched LLM call (Batch 10) — or heuristics for now
  intent: "commercial" | "transactional" | "informational" | "navigational" | null;
  hasNaturalToolTieIn: boolean; // e.g. "ats checker" → true, "what is a resume" → false
  isMoneyPageAdjacent: boolean; // tool/comparison keyword
};

export type ScoreBreakdown = {
  demand: number; // 0-3
  serpOpp: number; // 0-4
  fit: number; // 0-3
  opportunityScore: number; // 0-10
  decision: "TARGET" | "WATCH" | "PARK";
  overrideReason: string;
  // Evidence, for storage + display in the review UI:
  giantsInTop10: number;
  weakSitesInTop10: number;
  communityInTop10: number;
};

// ── Demand ──

export function scoreDemand(d: DemandInput): number {
  let s = 0;

  if (d.gscImpressions >= 1) s += 2; // Google is already testing us
  if (d.gscPosition > 0 && d.gscPosition <= 30) s += 1;

  // Fallback when we have no GSC data
  if (d.gscImpressions === 0 && d.gscPosition === 0) {
    if (d.autocompleteHits >= 2) s += 1;
    if (d.paas.length >= 1) s += 1;
  }

  return Math.min(s, 3);
}

// ── SERP Opportunity ──

export function scoreSerpOpp(input: SerpOppInput): {
  score: number; // 0-4
  giants: number;
  weak: number;
  community: number;
} {
  let s = 0;
  let giants = 0;
  let weak = 0;
  let community = 0;

  for (const r of input.results) {
    const dom = r.domain.toLowerCase();
    if (!dom) continue;

    if (GIANTS.some((g) => dom === g || dom.endsWith(`.${g}`))) {
      giants++;
      s -= 3;
      continue;
    }

    if (COMMUNITY_DOMAINS.some((c) => dom === c || dom.endsWith(`.${c}`))) {
      community++;
      s += 2;
      continue;
    }

    // Small / unknown domain heuristic: not a giant, not a community site.
    // The brief treats these as +1 each (cap +2). We treat "weak" as
    // anything with a domain that isn't in either list — a rough proxy for
    // "unknown to us", which is exactly what a young domain can outrank.
    weak++;
    s += 1;
  }

  // Caps from the brief
  s = Math.min(s, 4);
  return { score: Math.max(0, s), giants, weak: Math.min(weak, 2), community };
}

// ── Fit ──

export function scoreFit(f: FitInput): number {
  let s = 0;

  if (f.intent === "commercial" || f.intent === "transactional") s += 2;
  else if (f.intent === "informational" && f.hasNaturalToolTieIn) s += 1;
  else if (f.intent === "informational") s += 0;

  if (f.isMoneyPageAdjacent) s += 1;

  return Math.min(s, 3);
}

// ── Full score + decisions + hard overrides ──

export function scoreKeyword(
  demand: DemandInput,
  serp: SerpOppInput,
  fit: FitInput,
): ScoreBreakdown {
  const d = scoreDemand(demand);
  const so = scoreSerpOpp(serp);
  const f = scoreFit(fit);

  let total = d + so.score + f;
  if (total < 0) total = 0;
  if (total > 10) total = 10;

  // ── Hard overrides (beat the score) ──
  let override = "";

  if (so.giants >= 3) {
    override = `PARK — ${so.giants} giants in top 10`;
    return {
      demand: d,
      serpOpp: so.score,
      fit: f,
      opportunityScore: total,
      decision: "PARK",
      overrideReason: override,
      giantsInTop10: so.giants,
      weakSitesInTop10: so.weak,
      communityInTop10: so.community,
    };
  }

  const decision: ScoreBreakdown["decision"] =
    total >= 7 ? "TARGET" : total >= 4 ? "WATCH" : "PARK";

  return {
    demand: d,
    serpOpp: so.score,
    fit: f,
    opportunityScore: total,
    decision,
    overrideReason: override,
    giantsInTop10: so.giants,
    weakSitesInTop10: so.weak,
    communityInTop10: so.community,
  };
}

/**
 * Cheap heuristic fit classifier — used ONLY when we haven't yet run the
 * batched LLM classifier (Batch 10). The LLM classifier is authoritative;
 * this is a placeholder so keyword-harvest can ship without an LLM key wired.
 */
export function heuristicFit(keyword: string): FitInput {
  const k = keyword.toLowerCase();

  const commercial =
    /(best|top|review|compare|vs|alternative|tool|software|app|checker|generator|builder|calculator|scanner)/.test(
      k,
    );
  const transactional = /(free|download|template|buy|price|cost)/.test(k);
  const money = /(ats|resume|cover letter|cv|interview|salary|negotiat)/.test(k);

  if (commercial) {
    return {
      intent: "commercial",
      hasNaturalToolTieIn: true,
      isMoneyPageAdjacent: money,
    };
  }
  if (transactional) {
    return {
      intent: "transactional",
      hasNaturalToolTieIn: true,
      isMoneyPageAdjacent: money,
    };
  }
  // informational default
  return {
    intent: "informational",
    hasNaturalToolTieIn: money, // has a tool tie-in if it's career-adjacent
    isMoneyPageAdjacent: false,
  };
}