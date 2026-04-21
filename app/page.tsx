import DashboardShell from "@/src/components/dashboard-shell";
import { INITIAL_APPROVALS } from "@/src/data";

export default function Home() {
  return <DashboardShell approvals={INITIAL_APPROVALS} />;
}
