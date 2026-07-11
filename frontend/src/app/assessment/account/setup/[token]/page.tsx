import { AccountSetupClient } from "@/components/account-setup-client";

export default async function AccountSetupPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AccountSetupClient inviteToken={token} />;
}
