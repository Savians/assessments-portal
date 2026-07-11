import { AgreementClient } from "@/components/agreement-client";
export default async function AgreementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AgreementClient token={token} />;
}