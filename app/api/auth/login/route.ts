import { authConfig } from "@/lib/env";
import { clientIp, errorResponse, isSameOrigin, json } from "@/lib/http";
import { clearFailures, LOCK_SECONDS, lockedFor, recordFailure } from "@/lib/lockout";
import { verifyCredentials } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

function lockedMessage(seconds: number): string {
  return `登录失败次数过多，已锁定，请 ${Math.ceil(seconds / 60)} 分钟后再试`;
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "非法来源" }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const { username, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string"
    || username.length < 1 || username.length > 64 || password.length < 1 || password.length > 256) {
    return json({ error: "请输入用户名和密码" }, 400);
  }

  try {
    const expected = authConfig();
    const ip = clientIp(req);

    // Checked before the password so a locked account rejects even correct credentials.
    const locked = await lockedFor(username, ip);
    if (locked > 0) return json({ error: lockedMessage(locked) }, 429);

    if (!(await verifyCredentials(username, password, expected))) {
      const left = await recordFailure(username, ip);
      if (left === 0) return json({ error: lockedMessage(LOCK_SECONDS) }, 429);
      return json({ error: `用户名或密码错误，还可尝试 ${left} 次` }, 401);
    }

    await clearFailures(username, ip);
    const res = json({ ok: true });
    res.headers.append(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, createSessionToken(expected.username), SESSION_TTL_SECONDS),
    );
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  const parts = [`${name}=${value}`, `Path=${sessionCookieOptions.path}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict"];
  if (sessionCookieOptions.secure) parts.push("Secure");
  return parts.join("; ");
}
