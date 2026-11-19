// lib/bing.ts — Bing Webmaster Tools API wrapper
// Auth: ?apikey=<BING_API_KEY> (from bing.com/webmasters → Settings → API)
// Docs: https://learn.microsoft.com/en-us/bingwebmaster/

const BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export async function bingSubmitUrls(
  siteUrl: string,
  urls: string[],
): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.BING_API_KEY;
  if (!key) return { ok: false, detail: "BING_API_KEY not set" };
  if (urls.length === 0) return { ok: true, detail: "nothing to submit" };

  const endpoint = new URL(`${BASE}/SubmitUrlbatch`);
  endpoint.searchParams.set("apikey", key);

  const res = await fetch(endpoint.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteUrl, urlList: urls }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  return { ok: true, detail: `submitted ${urls.length}` };
}

export async function bingQuota(
  siteUrl: string,
): Promise<{ dailyQuota: number; remaining: number } | null> {
  const key = process.env.BING_API_KEY;
  if (!key) return null;
  const endpoint = new URL(`${BASE}/GetUrlSubmissionQuota`);
  endpoint.searchParams.set("apikey", key);
  endpoint.searchParams.set("siteUrl", siteUrl);
  try {
    const res = await fetch(endpoint.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { d?: { DailyQuota?: number; Remaining?: number } };
    const d = j.d ?? {};
    return { dailyQuota: d.DailyQuota ?? 0, remaining: d.Remaining ?? 0 };
  } catch {
    return null;
  }
}