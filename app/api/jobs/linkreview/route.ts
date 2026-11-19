// app/api/jobs/linkreview/route.ts — weekly link review aggregation
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
import LinkTask from "@/models/LinkTask";
import Keyword from "@/models/Keyword";
import WeeklySnapshot from "@/models/WeeklySnapshot";
import { markJobFinished } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  return url.searchParams.get("key") === secret || req.headers.get("x-cron-secret") === secret;
}

function mondayOf(d: Date): Date {
  const x = new Date(d); x.setUTCHours(0, 0, 0, 0);
  const diff = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();

  const sites = await Site.find({ active: true });
  const out: Array<{
    site: string;
    referringDomains: number;
    placedLinks: number;
    placedLast7d: number;
    placedLast30d: number;
    waiting: number;
    topActions: string[];
  }> = [];

  for (const site of sites) {
    const placed = await LinkTask.countDocuments({ site: site._id, status: "placed" });
    const placed7 = await LinkTask.countDocuments({
      site: site._id, status: "placed",
      placedAt: { $gte: new Date(Date.now() - 7 * 86400000) },
    });
    const placed30 = await LinkTask.countDocuments({
      site: site._id, status: "placed",
      placedAt: { $gte: new Date(Date.now() - 30 * 86400000) },
    });
    const waiting = await LinkTask.countDocuments({
      site: site._id, status: "placed",
      judgeAfter: { $gt: new Date() },
    });

    const targetKeywords = await Keyword.find({ site: site._id, decision: "TARGET", status: { $in: ["new", "approved"] } })
      .sort({ opportunityScore: -1 })
      .limit(5)
      .lean();

    const actions: string[] = [];
    if (waiting > 0) actions.push(`${waiting} placed links still in 60-day patience window — do NOT judge yet`);
    for (const k of targetKeywords) {
      actions.push(`Approve/brief TARGET keyword: "${k.keyword}" (score ${k.opportunityScore})`);
    }
    if (placed7 === 0 && placed30 < 4) actions.push("No links placed in last 7 days — send 5 outreach emails this week");
    if (actions.length === 0) actions.push("No urgent link actions — continue scheduled rituals");

    const week = mondayOf(new Date());
    await WeeklySnapshot.findOneAndUpdate(
      { site: site._id, week },
      { $set: { referringDomains: placed, linksReceivedLive: placed } },
      { upsert: true },
    );

    out.push({
      site: String(site._id),
      referringDomains: placed,
      placedLinks: placed,
      placedLast7d: placed7,
      placedLast30d: placed30,
      waiting,
      topActions: actions.slice(0, 5),
    });
  }

  await markJobFinished("linkreview", true, `${out.length} sites reviewed`);
  return NextResponse.json({ ok: true, sites: out });
}