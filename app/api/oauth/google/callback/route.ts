// app/api/oauth/google/callback/route.ts — finish the GSC OAuth flow
import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import { encrypt } from "@/lib/crypto";
import Site from "@/models/Site";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const siteId = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const back = (msg: string) =>
    NextResponse.redirect(
      new URL(`/sites?oauth=${encodeURIComponent(msg)}`, req.url),
    );

  if (error) return back(`error:${error}`);
  if (!code || !siteId) return back("error:missing_code_or_state");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return back("error:server_misconfigured");
  }

  // Exchange code → tokens
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return back(`error:token_exchange_failed:${res.status}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!json.refresh_token) {
    return back(
      "error:no_refresh_token (revoke access at myaccount.google.com/permissions and retry)",
    );
  }

  await dbConnect();
  const site = await Site.findById(siteId);
  if (!site) return back("error:site_not_found");

  site.gscRefreshToken = encrypt(json.refresh_token);
  site.gscConnectedAt = new Date();
  await site.save();

  return NextResponse.redirect(new URL("/sites?oauth=ok", req.url));
}