import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authConfig } from "./env";

export const SESSION_COOKIE = "lk_session";
export const SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

type Session = { u: string; exp: number };

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(username: string): string {
  const { sessionSecret } = authConfig();
  const session: Session = { u: username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, sessionSecret)}`;
}

function verifySessionToken(token: string): Session | null {
  const { sessionSecret, username } = authConfig();
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload, sessionSecret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof session.exp !== "number" || session.exp < Date.now() / 1000) return null;
    // A renamed admin invalidates old sessions.
    if (session.u !== username) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
