// lib/crypto.ts — AES-256-GCM encrypt/decrypt for secrets at rest
// Used for: Site.publishKey, Site.gscRefreshToken (never store these in plaintext)
import crypto from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length !== 64) {
    throw new Error(
      'ENCRYPTION_SECRET must be a 64-char hex string (32 bytes). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(secret, "hex");
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // single stored string: iv : authTag : ciphertext (all base64url)
  return [iv, tag, encrypted]
    .map((b) => Buffer.from(b).toString("base64url"))
    .join(":");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(":").map((s) => Buffer.from(s, "base64url"));
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}