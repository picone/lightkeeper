import "server-only";
import { Redis } from "@upstash/redis";
import { redisConfig } from "./env";

// Upstash Redis from the Vercel Marketplace integration, in every environment.
// Locally, `vercel env pull .env.local` brings down the same credentials.
let client: Redis | undefined;

export function redis(): Redis {
  client ??= new Redis(redisConfig());
  return client;
}

// Best-effort mutual exclusion for operations that must not overlap (e.g. IP rotation).
export async function withLock<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | null> {
  const key = `lk:lock:${name}`;
  const token = crypto.randomUUID();
  if ((await redis().set(key, token, { nx: true, ex: ttlSeconds })) !== "OK") return null;
  try {
    return await fn();
  } finally {
    // Only delete the lock if it is still ours.
    if ((await redis().get<string>(key)) === token) await redis().del(key);
  }
}
