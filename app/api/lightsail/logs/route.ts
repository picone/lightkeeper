import { errorResponse, guard, json } from "@/lib/http";
import { getRecentOperations } from "@/lib/lightsail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    return json({ operations: await getRecentOperations() });
  } catch (err) {
    return errorResponse(err);
  }
}
