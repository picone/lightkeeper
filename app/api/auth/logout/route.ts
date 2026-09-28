import { isSameOrigin, json } from "@/lib/http";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "非法来源" }, 403);
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
  return res;
}
