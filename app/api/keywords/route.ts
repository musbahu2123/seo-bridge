import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getSession } from "@/lib/admin";
import Keyword from "@/models/Keyword";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const decision = url.searchParams.get("decision");
  const site = url.searchParams.get("site");
  const q = url.searchParams.get("q");

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (decision) filter.decision = decision;
  if (site) filter.site = site;
  if (q) filter.keyword = { $regex: q, $options: "i" };

  const keywords = await Keyword.find(filter)
    .sort({ opportunityScore: -1, createdAt: -1 })
    .limit(500)
    .lean();

  return NextResponse.json({ keywords });
}