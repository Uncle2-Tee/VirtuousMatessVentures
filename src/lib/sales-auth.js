import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SALES_SESSION_COOKIE = "sabbybestcollection_sales_session";
const SESSION_MAX_AGE = 60 * 60 * 8;

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function signaturesMatch(expected, received) {
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(received || "").digest();
  return timingSafeEqual(expectedHash, receivedHash);
}

export function isSalesAuthConfigured() {
  return Boolean(process.env.SALES_USERNAME?.trim() && process.env.SALES_PASSWORD && sessionSecret());
}

export function salesCredentialsMatch(username, password) {
  const configuredUsername = process.env.SALES_USERNAME?.trim();
  const configuredPassword = process.env.SALES_PASSWORD;
  if (!configuredUsername || typeof username !== "string" || typeof password !== "string") return false;
  return signaturesMatch(configuredUsername.toLowerCase(), username.trim().toLowerCase())
    && signaturesMatch(configuredPassword, password);
}

export function createSalesSession() {
  const secret = sessionSecret();
  const username = process.env.SALES_USERNAME?.trim();
  if (!secret || !username) return null;

  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({ role: "salesperson", username, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { value: `${payload}.${signature}`, expiresAt, username };
}

export function getSalesSessionUsername(session = "") {
  if (!isSalesAuthConfigured()) return null;
  const secret = sessionSecret();
  const [payload, signature, extra] = session.split(".");
  if (!secret || extra || !payload || !signature) return null;

  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!signaturesMatch(expectedSignature, signature)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.role !== "salesperson"
      || typeof claims.username !== "string"
      || claims.username !== process.env.SALES_USERNAME?.trim()
      || !Number.isFinite(claims.expiresAt)
      || claims.expiresAt <= Date.now()) return null;
    return claims.username;
  } catch {
    return null;
  }
}

export const salesSessionOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
};
