// lib/serper.ts — Serper.dev wrapper (SERP + PAA + related + SERP features)
// Free tier: 2,500 one-time credits, no card. One credit = one SERP call.
// Docs: https://serper.dev/playground
//
// We use "google.serper.dev/search" — returns organic results, People Also Ask,
// related searches, and SERP features (answerBox, knowledgeGraph, topStories,
// videoResults, images) in one call. One call per seed keyword.
//
// SERP features drive R5: if the SERP shows a table snippet, brief-generator
// instructs the LLM to include a comparison table. If it shows a list snippet,
// expect a list. Etc.

const SERPER_URL = "https://google.serper.dev/search";

export type SerperOrganicResult = {
  title: string;
  link: string;
  domain: string;
  snippet?: string;
  position: number;
};

export type SerperPaaItem = {
  question: string;
  snippet?: string;
  link?: string;
};

export type SerperResponse = {
  organic: SerperOrganicResult[];
  peopleAlsoAsk: SerperPaaItem[];
  relatedSearches: { query: string }[];
};

export type SerperFetchResult = {
  query: string;
  organic: SerperOrganicResult[];
  paas: string[];
  related: string[];
  // NEW (Batch 4 / R5):
  serpFeatures: string[];        // e.g. ["featured_snippet:table", "knowledge_panel", "video"]
  featuredSnippetType: string | null; // "paragraph" | "list" | "table" | "video" | null
  raw?: unknown;
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function serperSearch(
  query: string,
  opts: { gl?: string; hl?: string; num?: number } = {},
): Promise<SerperFetchResult> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY not set");

  const res = await fetch(SERPER_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: opts.gl ?? "us",
      hl: opts.hl ?? "en",
      num: opts.num ?? 10,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Serper failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    organic?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      position?: number;
    }>;
    peopleAlsoAsk?: Array<{ question?: string; snippet?: string; link?: string }>;
    relatedSearches?: Array<{ query?: string }>;
    // SERP feature blocks (shape loosely typed — Serper varies across queries)
    answerBox?: {
      snippet?: string;
      title?: string;
      link?: string;
      snippetHighlighted?: string[];
      list?: unknown[];
      table?: unknown[][];
    };
    knowledgeGraph?: { title?: string; type?: string; description?: string };
    topStories?: Array<{ title?: string; link?: string; source?: string }>;
    videoResults?: Array<{ title?: string; link?: string; source?: string }>;
    images?: Array<{ title?: string; imageUrl?: string }>;
    inlineImages?: Array<{ title?: string; imageUrl?: string }>;
  };

  const organic: SerperOrganicResult[] = (json.organic ?? []).map((o, i) => ({
    title: o.title ?? "",
    link: o.link ?? "",
    domain: o.link ? domainOf(o.link) : "",
    snippet: o.snippet,
    position: o.position ?? i + 1,
  }));

  const paas = (json.peopleAlsoAsk ?? [])
    .map((p) => (p.question ?? "").trim())
    .filter(Boolean);

  const related = (json.relatedSearches ?? [])
    .map((r) => (r.query ?? "").trim())
    .filter(Boolean);

  // ── SERP features (R5) ──
  const serpFeatures: string[] = [];
  let featuredSnippetType: string | null = null;

  if (json.answerBox) {
    serpFeatures.push("featured_snippet");
    if (Array.isArray(json.answerBox.table) && json.answerBox.table.length > 0) {
      featuredSnippetType = "table";
      serpFeatures.push("featured_snippet:table");
    } else if (Array.isArray(json.answerBox.list) && json.answerBox.list.length > 0) {
      featuredSnippetType = "list";
      serpFeatures.push("featured_snippet:list");
    } else if (json.answerBox.snippet) {
      featuredSnippetType = "paragraph";
      serpFeatures.push("featured_snippet:paragraph");
    }
  }

  if (json.knowledgeGraph) serpFeatures.push("knowledge_panel");
  if (Array.isArray(json.topStories) && json.topStories.length > 0) {
    serpFeatures.push("top_stories");
  }
  if (Array.isArray(json.videoResults) && json.videoResults.length > 0) {
    serpFeatures.push("video");
  }
  const imgs = json.images ?? json.inlineImages;
  if (Array.isArray(imgs) && imgs.length > 0) serpFeatures.push("image_pack");

  return {
    query,
    organic,
    paas,
    related,
    serpFeatures,
    featuredSnippetType,
    raw: json,
  };
}