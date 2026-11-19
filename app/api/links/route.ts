//app/api/links/route.ts
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getSession } from "@/lib/admin";
import LinkTask from "@/models/LinkTask";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  const links = await LinkTask.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  return NextResponse.json({ links });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();
  const body = await req.json() as Record<string, unknown>;

  const required = ["site", "play", "targetDomain"];
  for (const f of required) {
    if (!body[f] || typeof body[f] !== "string") {
      return NextResponse.json({ error: `Missing field: ${f}` }, { status: 400 });
    }
  }

  const doc = await LinkTask.create({
    site: body.site,
    play: body.play,
    source: body.source ?? "manual",
    targetDomain: String(body.targetDomain).toLowerCase().trim(),
    targetUrl: body.targetUrl ?? "",
    pageType: body.pageType ?? "n/a",
    dr: typeof body.dr === "number" ? body.dr : null,
    contact: body.contact ?? "",
    citedCount: typeof body.citedCount === "number" ? body.citedCount : 0,
    proofUrl: body.proofUrl ?? "",
    emailDraft: body.emailDraft ?? "",
    notes: body.notes ?? "",
  });

  return NextResponse.json({ link: doc }, { status: 201 });
}