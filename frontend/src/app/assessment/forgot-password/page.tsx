import type { Metadata } from "next";
import { ForgotPasswordClient } from "@/components/forgot-password-client";

export const metadata: Metadata = { title: "Forgot Password" };

export default async function ForgotPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ email?: string; returnTo?: string }>;
}) {
  const { email = "", returnTo = "/portal/dashboard" } = await searchParams;
  return <ForgotPasswordClient initialEmail={email} returnTo={returnTo} />;
}
