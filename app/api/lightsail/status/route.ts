import { errorResponse, guard, json, parseRange } from "@/lib/http";
import { getInstanceMetrics, getInstanceOverview } from "@/lib/lightsail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const days = parseRange(req);
  if (!days) return json({ error: "days 只能是 1、3、7" }, 400);
  try {
    const [overview, metrics] = await Promise.all([getInstanceOverview(), getInstanceMetrics(days)]);
    return json({ ...overview, metrics });
  } catch (err) {
    return errorResponse(err);
  }
}
