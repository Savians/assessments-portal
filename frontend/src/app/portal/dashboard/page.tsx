import { PortalDashboardClient } from "@/components/portal-dashboard-client";

export const metadata = {
  title: "Client Dashboard | Savians Tax Assessment Portal"
};

export default async function PortalDashboardPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email = "" } = await searchParams;
  return <PortalDashboardClient initialEmail={email} />;
}
