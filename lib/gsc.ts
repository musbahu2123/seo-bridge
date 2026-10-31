// lib/gsc.ts — Google Search Console API wrapper
// OAuth refresh + Search Analytics + URL Inspection.
// Data settles 2-3 days → always query completed windows (end = today - 3).
import { decrypt } from "@/lib/crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_ANALYTICS =
  "https://searchconsole.googleapis.com/webmasters/v3/sites";
const URL_INSPECTION =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

// ── OAuth ──

export type TokenResult = {
  accessToken: string;
  expiresAt: number; // ms epoch
};

export async function refreshAccessToken(
  refreshTokenPlain: string,
): Promise<TokenResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshTokenPlain,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC token refresh failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
}

// In-memory cache so a single job run reuses one token across many queries.
const tokenCache = new Map<string, TokenResult>();

export async function getAccessToken(
  encryptedRefreshToken: string,
): Promise<string> {
  const plain = decrypt(encryptedRefreshToken);
  const cached = tokenCache.get(plain);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const fresh = await refreshAccessToken(plain);
  tokenCache.set(plain, fresh);
  return fresh.accessToken;
}

// ── Date windows ──

/** GSC data settles in 2-3 days. End the window 3 days ago. */
export function settledEndDate(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 3);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function window28d(now = new Date()): {
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
} {
  const end = settledEndDate(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27); // 28 days inclusive

  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - 27);

  return {
    startDate: isoDate(start),
    endDate: isoDate(end),
    prevStartDate: isoDate(prevStart),
    prevEndDate: isoDate(prevEnd),
  };
}

// ── Search Analytics ──

export type SearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchAnalyticsQuery = {
  siteUrl: string; // "sc-domain:example.com" or "https://www.example.com/"
  startDate: string;
  endDate: string;
  dimensions: ("query" | "page" | "country" | "device" | "date")[];
  rowLimit?: number;
  startRow?: number;
  dataState?: "final" | "all";
};

export async function searchAnalytics(
  accessToken: string,
  q: SearchAnalyticsQuery,
): Promise<SearchAnalyticsRow[]> {
  const url = `${SEARCH_ANALYTICS}/${encodeURIComponent(q.siteUrl)}/searchAnalytics/query`;

  const body: Record<string, unknown> = {
    startDate: q.startDate,
    endDate: q.endDate,
    dimensions: q.dimensions,
    rowLimit: q.rowLimit ?? 25000,
    dataState: q.dataState ?? "final",
  };
  if (q.startRow) body.startRow = q.startRow;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC searchAnalytics failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { rows?: SearchAnalyticsRow[] };
  return json.rows ?? [];
}

/** Paginate through all rows (GSC max 25k/request). */
export async function searchAnalyticsAll(
  accessToken: string,
  q: SearchAnalyticsQuery,
): Promise<SearchAnalyticsRow[]> {
  const rows: SearchAnalyticsRow[] = [];
  let startRow = 0;
  const pageSize = Math.min(q.rowLimit ?? 25000, 25000);

  for (;;) {
    const batch = await searchAnalytics(accessToken, {
      ...q,
      rowLimit: pageSize,
      startRow,
    });
    rows.push(...batch);
    if (batch.length < pageSize) break;
    startRow += batch.length;
    if (startRow > 100_000) break; // hard safety cap
  }

  return rows;
}

// ── URL Inspection (Batch 12) ──

export type InspectionResult = {
  url: string;
  coverageState: string;
  indexingState: string;
  verdict: string;
  lastCrawlTime: string | null;
};

export async function inspectUrl(
  accessToken: string,
  siteUrl: string,
  inspectionUrl: string,
): Promise<InspectionResult> {
  const res = await fetch(URL_INSPECTION, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inspectionUrl,
      siteUrl,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC inspectUrl failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    inspectionResult?: {
      indexStatusResult?: {
        coverageState?: string;
        indexingState?: string;
        verdict?: string;
        lastCrawlTime?: string;
      };
    };
  };
  const r = json.inspectionResult?.indexStatusResult ?? {};
  return {
    url: inspectionUrl,
    coverageState: r.coverageState ?? "",
    indexingState: r.indexingState ?? "",
    verdict: r.verdict ?? "",
    lastCrawlTime: r.lastCrawlTime ?? null,
  };
}