import "server-only";
import { createHash } from "node:crypto";
import { redis } from "./redis";

export const MAX_ATTEMPTS = 5;
export const LOCK_SECONDS = 15 * 60;

function key(kind: "user" | "ip", value: string): string {
  // Hash so arbitrary input never shapes the key.
  return `lk:fail:${kind}:${createHash("sha256").update(value).digest("hex")}`;
}

function keysFor(username: string, ip: string): string[] {
  return [key("user", username.toLowerCase()), key("ip", ip)];
}

/** Seconds the login stays locked for this username or IP; 0 when not locked. */
export async function lockedFor(username: string, ip: string): Promise<number> {
  let longest = 0;
  for (const k of keysFor(username, ip)) {
    const count = (await redis().get<number>(k)) ?? 0;
    if (count >= MAX_ATTEMPTS) {
      const ttl = await redis().ttl(k);
      longest = Math.max(longest, ttl > 0 ? ttl : LOCK_SECONDS);
    }
  }
  return longest;
}

/** Records one failed attempt. Returns attempts left before lockout (0 = now locked). */
export async function recordFailure(username: string, ip: string): Promise<number> {
  const pipe = redis().pipeline();
  for (const k of keysFor(username, ip)) {
    pipe.incr(k);
    pipe.expire(k, LOCK_SECONDS);
  }
  const results = await pipe.exec<number[]>();
  const counts = results.filter((_, i) => i % 2 === 0);
  return Math.max(0, MAX_ATTEMPTS - Math.max(...counts));
}

export async function clearFailures(username: string, ip: string): Promise<void> {
  await redis().del(...keysFor(username, ip));
}
