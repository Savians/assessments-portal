import Link from "next/link";
import { ArrowRight, CheckCircle2, LockKeyhole, ReceiptText, ShieldCheck } from "lucide-react";
import { Card, StatusBadge, Stepper } from "@/components/ui";
import { formatServiceAmount } from "@/lib/constants";

const routeDetails: Record<string, { title: string; description: string; step: number }> = {
  "assessment/start": {
    title: "Start Your Tax Assessment",
    description: "Minimum contact and assessment details will be collected here.",
    step: 0
  },
  "assessment/recover": {
    title: "Recover Your Assessment",
    description: "Verified email recovery will return clients to their exact prior stage.",
    step: 0
  },
  "create-account": {
    title: "Create Your Savians Account",
    description: "Invite-only account setup unlocks after QuickBooks payment is verified.",
    step: 2
  },
  "portal/dashboard": {
    title: "Assessment Dashboard",
    description: "Annual assessment progress, outstanding actions, and secure next steps.",
    step: 3
  },
  "portal/profile": {
    title: "Client Profile",
    description: "The intelligent personal and household intake will live here.",
    step: 3
  },
  "portal/real-estate": {
    title: "Real Estate",
    description: "Conditional property intake for primary, rental, and investment real estate.",
    step: 3
  },
  "portal/business-investments": {
    title: "Business & Investments",
    description: "Conditional, repeatable business and investment entity intake.",
    step: 3
  },
  "portal/documents": {
    title: "Secure Documents",
    description: "Paid, authenticated clients will upload categorized tax documents here.",
    step: 3
  }
};

const steps = ["Start", "Agreement & invoice", "Payment & account", "Profile & documents"] as const;

function LandingPage() {
  return (
    <>
      <section className="overflow-hidden bg-navy-900 py-20 text-white sm:py-28">
        <div className="page-shell grid items-center gap-12 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <span className="mb-5 inline-flex rounded-full border border-gold-400/40 bg-gold-400/10 px-4 py-2 text-sm font-semibold text-gold-100">
              Proactive, secure, and built around your tax picture
            </span>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
              Start Your Savians Tax Assessment
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
              A {formatServiceAmount()} proactive tax review designed to uncover legal,
              IRS-compliant savings opportunities before you file.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-lg bg-gold-400 px-6 py-3 font-bold text-navy-900 hover:bg-gold-100"
                href="/assessment/start"
              >
                Start My Assessment <ArrowRight aria-hidden size={18} />
              </Link>
              <Link
                className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-lg border border-white/25 px-6 py-3 font-bold text-white hover:bg-white/10"
                href="/assessment/recover"
              >
                Sign In / Resume
              </Link>
              <span className="flex items-center gap-2 text-sm text-slate-300">
                <LockKeyhole aria-hidden size={17} /> Portal access unlocks after verified payment
              </span>
            </div>
          </div>
          <Card className="border-white/10 bg-white text-slate-800">
            <p className="text-sm font-semibold uppercase tracking-wider text-navy-500">
              Tax Assessment Fee
            </p>
            <p className="mt-2 text-4xl font-bold text-navy-800">{formatServiceAmount()}</p>
            <ul className="mt-6 grid gap-4 text-sm">
              {[
                "One-on-one tax deep dive",
                "Two-year retroactive tax review",
                "Projected tax liability analysis",
                "Personalized tax savings plan",
                "Strategy roadmap"
              ].map((item) => (
                <li className="flex gap-3" key={item}>
                  <CheckCircle2 aria-hidden className="shrink-0 text-emerald-600" size={19} />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>
      <section className="py-16 sm:py-20">
        <div className="page-shell mb-10 text-center">
          <p className="font-semibold text-gold-600">How it works</p>
          <h2 className="mt-2 text-3xl font-bold text-navy-800">A clear path from assessment to action</h2>
        </div>
        <div className="page-shell grid gap-6 md:grid-cols-3">
          {[
            [ShieldCheck, "Sign securely", "Review and electronically sign the current Assessment Legal Agreement."],
            [ReceiptText, "Pay through QuickBooks", "Receive one official invoice and follow payment status without duplicate billing."],
            [LockKeyhole, "Unlock your portal", "After payment verification, create your reusable account and complete annual intake."]
          ].map(([Icon, title, description]) => {
            const FeatureIcon = Icon as typeof ShieldCheck;
            return (
              <Card key={title as string}>
                <FeatureIcon aria-hidden className="text-gold-600" size={28} />
                <h2 className="mt-5 text-xl font-bold text-navy-800">{title as string}</h2>
                <p className="mt-3 leading-7 text-slate-600">{description as string}</p>
              </Card>
            );
          })}
        </div>
      </section>
      <section className="bg-white py-16 sm:py-20">
        <div className="page-shell grid gap-10 lg:grid-cols-2">
          <div>
            <p className="font-semibold text-gold-600">Why Savians</p>
            <h2 className="mt-2 text-3xl font-bold text-navy-800">
              Tax planning before decisions become deadlines
            </h2>
            <p className="mt-5 leading-8 text-slate-600">
              Your assessment is designed to organize the facts, identify IRS-compliant planning
              opportunities, and give you a practical strategy roadmap before implementation.
            </p>
          </div>
          <div className="rounded-2xl bg-navy-900 p-7 text-white">
            <h2 className="text-2xl font-bold">Payment and portal unlock</h2>
            <p className="mt-4 leading-7 text-slate-200">
              You will review and sign the Assessment Legal Agreement first. QuickBooks then sends
              one official {formatServiceAmount()} invoice. Your reusable Savians account unlocks
              only after the backend verifies that exact invoice is fully paid.
            </p>
          </div>
        </div>
      </section>
      <section className="py-16 sm:py-20">
        <div className="page-shell max-w-4xl">
          <p className="text-center font-semibold text-gold-600">Frequently asked questions</p>
          <h2 className="mt-2 text-center text-3xl font-bold text-navy-800">
            What to expect
          </h2>
          <div className="mt-10 grid gap-4">
            {[
              ["Will I be charged when I submit the form?", "No. A QuickBooks invoice is created only after you review and sign the legal agreement."],
              ["Can I finish later?", "Yes. Your annual assessment is saved and the same session is resumed, preventing duplicate invoices."],
              ["When can I upload documents?", "Document upload unlocks after full payment verification and account creation."],
              ["Is the assessment implementation?", "No. The assessment identifies and explains potential strategies. Implementation requires a separate written agreement when applicable."]
            ].map(([question, answer]) => (
              <details className="rounded-xl border border-slate-200 bg-white p-5" key={question}>
                <summary className="cursor-pointer font-semibold text-navy-800">{question}</summary>
                <p className="mt-3 leading-7 text-slate-600">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <section className="bg-gold-100 py-14">
        <div className="page-shell flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-3xl font-bold text-navy-800">Ready to begin?</h2>
            <p className="mt-2 text-slate-700">Start securely now and return later if you need to.</p>
          </div>
          <Link
            className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-lg bg-navy-800 px-6 py-3 font-bold text-white"
            href="/assessment/start"
          >
            Start My Assessment <ArrowRight aria-hidden size={18} />
          </Link>
          <Link
            className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-lg border border-navy-800 px-6 py-3 font-bold text-navy-800"
            href="/assessment/recover"
          >
            Sign In / Resume
          </Link>
        </div>
      </section>
    </>
  );
}

function PlaceholderPage({
  title,
  description,
  step
}: {
  title: string;
  description: string;
  step: number;
}) {
  return (
    <section className="page-shell min-h-[65vh] py-12 sm:py-16">
      <Stepper current={step} steps={steps} />
      <Card className="mt-10">
        <StatusBadge status="active">Phase 1 foundation</StatusBadge>
        <h1 className="mt-5 text-3xl font-bold text-navy-800 sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-2xl leading-7 text-slate-600">{description}</p>
        <p className="mt-8 rounded-xl bg-navy-50 p-4 text-sm text-navy-800">
          The route, layout, design system, and deployment boundary are ready. Business behavior
          will be added in its assigned implementation phase.
        </p>
      </Card>
    </section>
  );
}

export default async function CatchAllPage({
  params
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const path = slug.join("/");
  if (!path) return <LandingPage />;

  if (path.startsWith("assessment/agreement/")) {
    return (
      <PlaceholderPage
        title="Assessment Legal Agreement"
        description="The immutable agreement viewer and typed-signature evidence flow will be implemented here."
        step={1}
      />
    );
  }
  if (path.startsWith("assessment/status/")) {
    return (
      <PlaceholderPage
        title="Invoice & Payment Status"
        description="QuickBooks invoice status, refresh, resend, and paid verification will be shown here."
        step={2}
      />
    );
  }

  const detail = routeDetails[path];
  if (detail) return <PlaceholderPage {...detail} />;
  return (
    <PlaceholderPage
      title="Page not found"
      description="This route is not part of the Savians Tax Assessment workflow."
      step={0}
    />
  );
}
