import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "./customer-auth";
import { prisma } from "./prisma";

export const SALES_SESSION_COOKIE = "sabbybestcollection_sales_session";
const SESSION_MAX_AGE = 60 * 60 * 8;
const SALES_CREDENTIAL_ID = "sales";

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function signaturesMatch(expected, received) {
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(received || "").digest();
  return timingSafeEqual(expectedHash, receivedHash);
}

async function findStoredSalesCredential(includePasswordHash = false) {
  if (!process.env.DATABASE_URL) return null;
  return prisma.salesCredential.findUnique({
    where: { id: SALES_CREDENTIAL_ID },
    select: {
      username: true,
      sessionVersion: true,
      ...(includePasswordHash ? { passwordHash: true } : {}),
    },
  });
}

export async function getSalesLoginSettings() {
  const credential = await findStoredSalesCredential();
  return { username: credential?.username || process.env.SALES_USERNAME?.trim() || "" };
}

export async function isSalesAuthConfigured() {
  if (!sessionSecret()) return false;
  try {
    const credential = await findStoredSalesCredential();
    return Boolean(credential || (process.env.SALES_USERNAME?.trim() && process.env.SALES_PASSWORD));
  } catch (error) {
    console.error("Could not load stored sales credentials:", error);
    return Boolean(process.env.SALES_USERNAME?.trim() && process.env.SALES_PASSWORD);
  }
}

export async function salesCredentialsMatch(username, password) {
  if (typeof username !== "string" || typeof password !== "string") return false;
  const credential = await findStoredSalesCredential(true);
  if (credential) {
    const usernameMatches = signaturesMatch(credential.username.toLowerCase(), username.trim().toLowerCase());
    const passwordMatches = await verifyPassword(password, credential.passwordHash);
    return usernameMatches && passwordMatches;
  }

  const configuredUsername = process.env.SALES_USERNAME?.trim();
  const configuredPassword = process.env.SALES_PASSWORD;
  if (!configuredUsername || !configuredPassword) return false;
  return signaturesMatch(configuredUsername.toLowerCase(), username.trim().toLowerCase())
    && signaturesMatch(configuredPassword, password);
}

export async function updateSalesCredentials(username, password) {
  const passwordHash = await hashPassword(password);
  return prisma.salesCredential.upsert({
    where: { id: SALES_CREDENTIAL_ID },
    create: { id: SALES_CREDENTIAL_ID, username, passwordHash, sessionVersion: 1 },
    update: { username, passwordHash, sessionVersion: { increment: 1 } },
    select: { username: true },
  });
}

export async function createSalesSession() {
  const secret = sessionSecret();
  const credential = await findStoredSalesCredential();
  const username = credential?.username || process.env.SALES_USERNAME?.trim();
  if (!secret || !username) return null;

  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({
    role: "salesperson",
    username,
    expiresAt,
    sessionVersion: credential?.sessionVersion ?? 0,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { value: `${payload}.${signature}`, expiresAt, username };
}

export async function getSalesSessionUsername(session = "") {
  const secret = sessionSecret();
  const [payload, signature, extra] = session.split(".");
  if (!secret || extra || !payload || !signature) return null;

  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!signaturesMatch(expectedSignature, signature)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.role !== "salesperson"
      || typeof claims.username !== "string"
      || !Number.isFinite(claims.expiresAt)
      || claims.expiresAt <= Date.now()) return null;
    let credential;
    try {
      credential = await findStoredSalesCredential();
    } catch (error) {
      console.error("Could not verify salesperson session:", error);
      return null;
    }
    if (credential) {
      return claims.username === credential.username
        && claims.sessionVersion === credential.sessionVersion
        ? claims.username
        : null;
    }
    return claims.username === process.env.SALES_USERNAME?.trim()
      && (claims.sessionVersion ?? 0) === 0
      ? claims.username
      : null;
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
