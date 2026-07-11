import { PaymentStatusClient } from "@/components/payment-status-client";

export default async function AssessmentStatusPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PaymentStatusClient token={token} />;
}
