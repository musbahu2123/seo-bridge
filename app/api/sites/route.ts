// app/api/sites/route.ts — Sites CRUD (list + create)
// Secrets (publishKey, gscRefreshToken) are AES-256-GCM encrypted at rest via lib/crypto.
// publishKey is REQUIRED — the bridge must be able to actually publish to the tenant.
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { encrypt } from "@/lib/crypto";
import { getSession } from "@/lib/admin";
import Site from "@/models/Site";

// ── GET /api/sites — list all tenants (secrets stripped, one query) ──
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const sites = await Site.find({}).sort({ createdAt: -1 }).lean();

  const safe = sites.map((s: Record<string, unknown>) => {
    const { publishKey, gscRefreshToken, ...rest } = s as {
      publishKey?: string;
      gscRefreshToken?: string | null;
      [k: string]: unknown;
    };
    return {
      ...rest,
      hasPublishKey: !!publishKey && publishKey !== "",
      hasGscToken: !!gscRefreshToken && gscRefreshToken !== "",
    };
  });

  return NextResponse.json({ sites: safe });
}

// ── POST /api/sites — create a tenant ──
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Required fields ──
  const required = ["name", "domain", "sitemapUrl", "publishUrl"] as const;
  for (const field of required) {
    const v = body[field];
    if (typeof v !== "string" || v.trim().length === 0) {
      return NextResponse.json(
        { error: `Missing or invalid field: ${field}` },
        { status: 400 },
      );
    }
  }

  const name = String(body.name).trim();
  const domain = String(body.domain)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  const existing = await Site.findOne({ domain }).lean();
  if (existing) {
    return NextResponse.json(
      { error: `A site with domain "${domain}" already exists` },
      { status: 409 },
    );
  }

  // ── Required secret: publishKey ──
  // The bridge must be able to actually publish. If you haven't shipped the
  // SaaS ApiKey patch (brief §3.7) yet, do that first, create a key with
  // scope "blog:write", and paste its plaintext here.
  const publishKeyRaw =
    typeof body.publishKey === "string" ? body.publishKey.trim() : "";
  if (!publishKeyRaw) {
    return NextResponse.json(
      {
        error:
          "publishKey is required. Create an API key in the SaaS admin (ApiKey patch, brief §3.7) with scope blog:write, then paste it here.",
      },
      { status: 400 },
    );
  }
  const publishKey = encrypt(publishKeyRaw);

  // ── Optional secret: gscRefreshToken (normally set by OAuth in Batch 7) ──
  const gscRefreshToken =
    typeof body.gscRefreshToken === "string" &&
    body.gscRefreshToken.trim().length > 0
      ? encrypt(body.gscRefreshToken.trim())
      : null;

  // ── Normalize array fields ──
  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter((x) => x.length > 0)
      : [];

  const competitors = toStringArray(body.competitors);
  const buyerPrompts = toStringArray(body.buyerPrompts);
  const ctaPages = toStringArray(body.ctaPages);

  const categoryMap =
    body.categoryMap &&
    typeof body.categoryMap === "object" &&
    !Array.isArray(body.categoryMap)
      ? (body.categoryMap as Record<string, string>)
      : undefined;

  const gscSiteUrl =
    typeof body.gscSiteUrl === "string" && body.gscSiteUrl.trim().length > 0
      ? body.gscSiteUrl.trim()
      : undefined;

  try {
    const site = await Site.create({
      name,
      domain,
      sitemapUrl: String(body.sitemapUrl).trim(),
      competitors,
      positioning:
        typeof body.positioning === "string" ? body.positioning.trim() : "",
      buyerPrompts,
      publishUrl: String(body.publishUrl).trim(),
      publishKey,
      ...(gscRefreshToken ? { gscRefreshToken, gscConnectedAt: new Date() } : {}),
      ...(gscSiteUrl ? { gscSiteUrl } : {}),
      ...(categoryMap ? { categoryMap } : {}),
      ctaPages,
      active: true,
    });

    const doc = await Site.findById(site._id).lean();
    if (!doc) {
      return NextResponse.json(
        { error: "Site created but could not be re-read" },
        { status: 500 },
      );
    }
    const { publishKey: _pk, gscRefreshToken: _gsc, ...clean } = doc as Record<
      string,
      unknown
    > & { publishKey?: string; gscRefreshToken?: string | null };

    return NextResponse.json(
      {
        site: {
          ...clean,
          hasPublishKey: !!_pk,
          hasGscToken: !!_gsc,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const e = err as { code?: number; message?: string };
    if (e?.code === 11000) {
      return NextResponse.json(
        { error: `A site with domain "${domain}" already exists` },
        { status: 409 },
      );
    }
    console.error("[sites POST] error:", err);
    return NextResponse.json(
      { error: "Failed to create site", detail: String(e?.message ?? err) },
      { status: 500 },
    );
  }
}