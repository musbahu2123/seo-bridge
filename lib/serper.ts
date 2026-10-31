// lib/serper.ts — Serper.dev wrapper (SERP + PAA + related searches)
// Free tier: 2,500 one-time credits, no card. One credit = one SERP call.
// Docs: https://serper.dev/playground
//
// We use "google.serper.dev/search" — returns organic results, People Also Ask,
// and related searches in one call. One call per seed keyword.

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

  return { query, organic, paas, related, raw: json };
}