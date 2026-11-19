//app/api/review/[id]/route.ts
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getSession } from "@/lib/admin";
import ArticleJob from "@/models/ArticleJob";

const ALLOWED = new Set(["approved", "rejected"]);

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();
  const { id } = await params;
  const job = await ArticleJob.findById(id).lean();
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();
  const { id } = await params;
  const body = (await req.json()) as { status?: string; reviewNotes?: string };

  const update: Record<string, unknown> = {};
  if (body.status) {
    if (!ALLOWED.has(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = body.status;
    update.reviewedBy = s.email;
  }
  if (typeof body.reviewNotes === "string") update.reviewNotes = body.reviewNotes;

  const job = await ArticleJob.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}