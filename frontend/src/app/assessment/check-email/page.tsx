import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Check Your Email" };

export default function CheckEmailPage() {
  return (
    <section className="page-shell min-h-[65vh] py-14">
      <Card className="mx-auto max-w-2xl text-center">
        <MailCheck aria-hidden className="mx-auto text-gold-600" size={42} />
        <h1 className="mt-5 text-3xl font-bold text-navy-800">Check your email</h1>
        <p className="mt-4 leading-7 text-slate-600">
          We found an assessment for this year. For your privacy, the secure resume link has been
          sent to the email address on that assessment.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          This page does not confirm account, invoice, or payment details.
        </p>
        <Link
          className="focus-ring mt-7 inline-flex rounded-lg border border-navy-800 px-5 py-3 font-semibold text-navy-800"
          href="/"
        >
          Return home
        </Link>
      </Card>
    </section>
  );
}
