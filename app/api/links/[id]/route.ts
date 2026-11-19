import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { getSession } from "@/lib/admin";
import LinkTask from "@/models/LinkTask";

const ALLOWED_STATUS = new Set(["prospect", "drafted", "sent", "replied", "placed", "rejected"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if (typeof body.status === "string") {
    if (!ALLOWED_STATUS.has(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    update.status = body.status;
    if (body.status === "placed") {
      const placedAt = new Date();
      update.placedAt = placedAt;
      update.judgeAfter = new Date(placedAt.getTime() + 60 * 24 * 60 * 60 * 1000);
    }
  }
  for (const k of ["placedUrl", "anchorText", "relAttribute", "emailDraft", "notes", "proofUrl", "contact", "targetUrl"]) {
    if (typeof body[k] === "string") update[k] = body[k];
  }
  if (typeof body.dr === "number") update.dr = body.dr;
  if (body.dr === null) update.dr = null;

  const link = await LinkTask.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ link });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await dbConnect();
  const { id } = await params;
  await LinkTask.findByIdAndDelete(id);
  return NextResponse.json({ ok: true });
}