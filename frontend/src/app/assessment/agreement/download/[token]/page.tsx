import type { Route } from "next";
import { redirect } from "next/navigation";
import { agreementDownloadApiUrl } from "@/services/assessment-api";

export default async function AgreementDownloadPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(agreementDownloadApiUrl(token) as Route);
}
