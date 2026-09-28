import { getARecords, getTraffic } from "@/lib/cloudflare";
import { errorResponse, guard, json, parseRange } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const days = parseRange(req);
  if (!days) return json({ error: "days 只能是 1、3、7" }, 400);
  try {
    // DNS lookup is only decoration here; don't let it hide the traffic data.
    const [traffic, records] = await Promise.all([
      getTraffic(days),
      getARecords().then(
        (r) => ({ records: r, recordsError: null }),
        (err: unknown) => {
          console.error(err);
          return { records: [], recordsError: err instanceof Error ? err.message : "读取 DNS 记录失败" };
        },
      ),
    ]);
    return json({ traffic, ...records });
  } catch (err) {
    return errorResponse(err);
  }
}
