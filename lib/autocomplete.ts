// lib/autocomplete.ts — Google Autocomplete scraper (no API key, unlimited)
// Endpoint: suggestqueries.google.com/complete/search?client=firefox&q=<prefix>
// Returns a JSON array: ["<prefix>", ["suggestion1", "suggestion2", ...], ...]
//
// Free and unlimited. Used to expand a seed keyword into long-tail variants.
// We only call this a handful of times per harvest run, so no rate-limit risk.

const ENDPOINT = "https://suggestqueries.google.com/complete/search";

export async function autocomplete(
  seed: string,
  opts: { gl?: string; hl?: string } = {},
): Promise<string[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("client", "firefox");
  url.searchParams.set("q", seed);
  url.searchParams.set("hl", opts.hl ?? "en");
  if (opts.gl) url.searchParams.set("gl", opts.gl);

  const res = await fetch(url.toString(), {
    headers: {
      // Google sometimes serves an HTML error page without a UA
      "User-Agent":
        "Mozilla/5.0 (compatible; SEOBridge/1.0; +https://resumetailorapp.com)",
      Accept: "application/json",
    },
    // Cheap safety: don't hang forever
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return [];

  // Response is JSON: ["seed", ["s1","s2",...], {...}]
  try {
    const json = (await res.json()) as unknown;
    if (
      Array.isArray(json) &&
      json.length >= 2 &&
      Array.isArray(json[1])
    ) {
      return (json[1] as unknown[])
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0 && s.toLowerCase() !== seed.toLowerCase());
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * Expand a seed into variants by appending common modifiers, then calling
 * autocomplete for each. Cheap (3 extra calls) and yields a lot of long-tail.
 */
export async function autocompleteExpand(
  seed: string,
  opts: { gl?: string; hl?: string } = {},
): Promise<{ variants: string[]; sources: Record<string, string[]> }> {
  const prefixes = [seed, `${seed} for`, `how to ${seed}`, `${seed} template`];
  const sources: Record<string, string[]> = {};
  const all = new Set<string>();

  for (const p of prefixes) {
    const out = await autocomplete(p, opts);
    sources[p] = out;
    for (const s of out) all.add(s);
  }

  return { variants: [...all], sources };
}