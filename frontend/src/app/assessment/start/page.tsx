import type { Metadata } from "next";
import Link from "next/link";
import { AssessmentStartForm } from "@/components/assessment-start-form";
import { Card, Stepper } from "@/components/ui";
import { formatServiceAmount } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Start Your Tax Assessment",
  description: "Start or resume your annual Savians Tax Assessment."
};

const steps = ["Start", "Agreement & invoice", "Payment & account", "Profile & documents"] as const;

export default function StartAssessmentPage() {
  return (
    <section className="page-shell py-10 sm:py-14">
      <Stepper current={0} steps={steps} />
      <div className="mx-auto mt-10 max-w-4xl">
        <div className="mb-7">
          <p className="font-semibold text-gold-600">Tax Assessment Fee: {formatServiceAmount()}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-800 sm:text-4xl">
            Start Your Savians Tax Assessment
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-slate-600">
            Enter the minimum information needed to begin. If you already started this year, we
            will securely resume the same assessment instead of creating a duplicate.
          </p>
        </div>
        <Card>
          <AssessmentStartForm />
        </Card>
        <p className="mt-6 text-center text-sm text-slate-500">
          Already started?{" "}
          <Link className="font-semibold text-navy-800 underline" href="/assessment/recover">
            Recover your assessment
          </Link>
        </p>
      </div>
    </section>
  );
}

