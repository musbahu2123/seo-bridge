// lib/admin.ts — bridge admin session (HMAC-signed cookie, no NextAuth)
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE = "bridge_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function key(): Buffer {
  const s = process.env.ENCRYPTION_SECRET;
  if (!s || s.length !== 64) {
    throw new Error("ENCRYPTION_SECRET must be set (64-char hex)");
  }
  return Buffer.from(s, "hex");
}

export function signSession(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + MAX_AGE * 1000 }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function getSession(): Promise<{ email: string } | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = crypto.createHmac("sha256", key()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || Date.now() > data.exp) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

export async function attemptLogin(
  email: string,
  password: string,
): Promise<boolean> {
  const okEmail = process.env.ADMIN_EMAIL;
  const okPassword = process.env.ADMIN_PASSWORD;
  if (!okEmail || !okPassword) return false;

  const a = Buffer.from(email.toLowerCase().trim());
  const b = Buffer.from(okEmail.toLowerCase());
  const pa = Buffer.from(password);
  const pb = Buffer.from(okPassword);

  const emailOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  const passOk = pa.length === pb.length && crypto.timingSafeEqual(pa, pb);
  return emailOk && passOk;
}

export async function createSession(email: string) {
  const store = await cookies();
  store.set(COOKIE, signSession(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}