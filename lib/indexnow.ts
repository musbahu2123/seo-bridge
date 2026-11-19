// lib/indexnow.ts — IndexNow ping (Bing/Yandex/etc.)
// Google ignores IndexNow, but it costs nothing and speeds up Bing.
export async function pingIndexNow(url: string): Promise<{ ok: boolean; detail?: string }> {
  const key = process.env.INDEXNOW_KEY;
  const bridgeUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!key) return { ok: false, detail: "INDEXNOW_KEY not set" };
  if (!bridgeUrl) return { ok: false, detail: "NEXT_PUBLIC_SITE_URL not set" };

  const endpoint = new URL("https://api.indexnow.org/indexnow");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("key", key);
  endpoint.searchParams.set("keyLocation", `${bridgeUrl.replace(/\/$/, "")}/api/indexnow/key`);

  try {
    const res = await fetch(endpoint.toString(), { signal: AbortSignal.timeout(10000) });
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}