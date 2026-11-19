import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getSession } from "@/lib/admin";
import Keyword from "@/models/Keyword";

const ALLOWED = new Set([
  "new",
  "approved",
  "briefed",
  "drafted",
  "published",
  "watch",
  "rejected",
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();

  const { id } = await params;
  const body = (await req.json()) as { status?: string; notes?: string };

  const update: Record<string, unknown> = {};
  if (body.status) {
    if (!ALLOWED.has(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = body.status;
  }
  if (typeof body.notes === "string") update.notes = body.notes;

  const kw = await Keyword.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!kw) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ keyword: kw });
}