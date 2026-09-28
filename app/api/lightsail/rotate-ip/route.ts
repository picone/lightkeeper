import { errorResponse, guard, json } from "@/lib/http";
import { withLock } from "@/lib/redis";
import { rotateStaticIp } from "@/lib/rotate";

export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = await guard(req, { write: true });
  if (denied) return denied;
  try {
    const result = await withLock("rotate-ip", 120, rotateStaticIp);
    if (!result) return json({ error: "已有一次换 IP 正在进行，请稍后刷新查看" }, 409);
    console.log("rotate-ip", JSON.stringify(result));
    return json(result, result.ok ? 200 : 500);
  } catch (err) {
    return errorResponse(err);
  }
}
