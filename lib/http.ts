import "server-only";
import { ConfigError } from "./env";
import { getSession } from "./session";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// Rejects cross-site writes. SameSite=Strict already blocks most CSRF; this is a second layer.
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function clientIp(req: Request): string {
  // On Vercel these headers are set by the platform, not passed through from the client.
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Returns an error response when the request is not allowed, otherwise null. */
export async function guard(req: Request, opts: { write?: boolean } = {}): Promise<Response | null> {
  if (opts.write && !isSameOrigin(req)) return json({ error: "非法来源" }, 403);
  try {
    if (!(await getSession())) return json({ error: "未登录" }, 401);
  } catch (err) {
    return errorResponse(err);
  }
  return null;
}

export function errorResponse(err: unknown): Response {
  console.error(err);
  if (err instanceof ConfigError) return json({ error: `配置错误：${err.message}` }, 500);
  const message = err instanceof Error ? err.message : "未知错误";
  return json({ error: message }, 502);
}

export type Range = 1 | 3 | 7;

export function parseRange(req: Request): Range | null {
  const value = new URL(req.url).searchParams.get("days");
  return value === "1" ? 1 : value === "3" ? 3 : value === "7" ? 7 : null;
}
