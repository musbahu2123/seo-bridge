// app/api/oauth/google/route.ts — start the GSC OAuth flow
import { NextResponse } from "next/server";
import { getSession } from "@/lib/admin";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI not set" },
      { status: 500 },
    );
  }

  // state = the siteId we're connecting (passed as ?site=<id>)
  const url = new URL(req.url);
  const site = url.searchParams.get("site");
  if (!site) {
    return NextResponse.json(
      { error: "Missing ?site=<siteId>" },
      { status: 400 },
    );
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent"); // force refresh_token every time
  authUrl.searchParams.set("state", site);

  return NextResponse.redirect(authUrl.toString());
}