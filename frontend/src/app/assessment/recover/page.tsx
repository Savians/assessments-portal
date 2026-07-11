import type { Metadata } from "next";
import { RecoverAssessmentClient } from "@/components/recover-assessment-client";

export const metadata: Metadata = { title: "Sign In / Resume Assessment" };

export default function RecoverAssessmentPage() {
  return <RecoverAssessmentClient />;
}
