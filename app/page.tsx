import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Dashboard username={session.u} />;
}
