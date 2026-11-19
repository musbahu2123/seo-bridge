// app/api/jobs/tick/route.ts — fired by components/JobTick.tsx on each admin navigation.
// Calls maybeRunDueJobs() and returns immediately. All actual work happens in
// separate /api/jobs/* invocations, so this route is always fast.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { maybeRunDueJobs } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  maybeRunDueJobs();
  return NextResponse.json({ ok: true, fired: new Date().toISOString() });
}