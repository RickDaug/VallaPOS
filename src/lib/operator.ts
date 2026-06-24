import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * The "active operator" on a shared device. The device holds an owner/manager
 * Better Auth session (the tenant gate); the active operator — set by entering a
 * PIN — is WHO is currently ringing up, drives capability checks, and is the
 * `cashierId` on their orders.
 *
 * It lives in a short-lived, HMAC-signed, httpOnly cookie (one per business).
 * The cookie is NEVER trusted on its own: getActiveOperator re-loads the
 * membership from the DB every time (must still be active + in this business),
 * so a revoked/deactivated operator stops working immediately. The signature
 * (BETTER_AUTH_SECRET) only stops trivial client-side forgery of the id.
 */

const TTL_MS = 30 * 60 * 1000; // hard cap; the UI also re-locks after each sale + idle

export interface ActiveOperator {
  membershipId: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
  permissions: string[];
  name: string;
}

function cookieName(businessId: string): string {
  return `vp_op_${businessId}`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payloadB64: string): string {
  return b64url(createHmac("sha256", env.BETTER_AUTH_SECRET).update(payloadB64).digest());
}

function makeToken(membershipId: string, exp: number): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify({ m: membershipId, exp })));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify signature + shape; returns the payload or null. Does NOT check the DB. */
function readToken(raw: string): { m: string; exp: number } | null {
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);
  const expected = sign(payloadB64);
  // Constant-time compare; lengths must match for timingSafeEqual.
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (typeof parsed?.m === "string" && typeof parsed?.exp === "number") {
      return { m: parsed.m, exp: parsed.exp };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setActiveOperator(businessId: string, membershipId: string): Promise<void> {
  const store = await cookies();
  store.set(cookieName(businessId), makeToken(membershipId, Date.now() + TTL_MS), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function clearActiveOperator(businessId: string): Promise<void> {
  const store = await cookies();
  store.set(cookieName(businessId), "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * The current active operator, or null when the device is "locked". Verifies the
 * cookie signature + expiry, then re-loads the membership (active + in business)
 * so attribution/capabilities always reflect live DB state.
 */
export async function getActiveOperator(businessId: string): Promise<ActiveOperator | null> {
  const store = await cookies();
  const raw = store.get(cookieName(businessId))?.value;
  if (!raw) return null;

  const token = readToken(raw);
  if (!token || token.exp < Date.now()) return null;

  const m = await db.membership.findFirst({
    where: { id: token.m, businessId, active: true },
    select: { id: true, role: true, permissions: true, name: true, user: { select: { name: true } } },
  });
  if (!m) return null;

  return {
    membershipId: m.id,
    role: m.role,
    permissions: m.permissions,
    name: m.user?.name ?? m.name ?? "Staff",
  };
}
