import { cookies } from "next/headers";
import DashboardShell from "@/src/components/dashboard-shell";
import { INITIAL_APPROVALS } from "@/src/data";

export default async function Home() {
  const cookieStore = await cookies();
  const savedTheme = cookieStore.get("dashboard-theme")?.value;
  const initialTheme = savedTheme === "light" ? "light" : "dark";

  return (
    <DashboardShell approvals={INITIAL_APPROVALS} initialTheme={initialTheme} />
  );
}
