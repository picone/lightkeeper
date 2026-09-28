import { errorResponse, guard, json } from "@/lib/http";
import { rebootInstance } from "@/lib/lightsail";

export async function POST(req: Request) {
  const denied = await guard(req, { write: true });
  if (denied) return denied;
  try {
    return json(await rebootInstance());
  } catch (err) {
    return errorResponse(err);
  }
}
