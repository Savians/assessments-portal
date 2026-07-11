"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { FileCheck2, LockKeyhole } from "lucide-react";
import { AssessmentApiError, loadAgreement, signAgreement, type AgreementDetailsResponse } from "@/services/assessment-api";
import { Button, Card, Checkbox, ErrorAlert, Input, LoadingOverlay, StatusBadge, Stepper } from "@/components/ui";
import { formatServiceAmount } from "@/lib/constants";

const steps = ["Start", "Agreement & invoice", "Payment & account", "Profile & documents"] as const;
export function AgreementClient({ token }: { token: string }) {
  const router = useRouter();
  const [details, setDetails] = useState<AgreementDetailsResponse>();
  const [typedName, setTypedName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    loadAgreement(token).then((value) => {
      if (!active) return;
      if (value.nextUrl) router.replace(value.nextUrl as Route);
      else setDetails(value);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "We could not load the agreement."); });
    return () => { active = false; };
  }, [router, token]);

  const submit = async () => {
    setError(undefined); setSubmitting(true);
    try {
      const result = await signAgreement({ token, typedSignatureName: typedName, acknowledgementAccepted: true });
      router.push(result.nextUrl as Route);
    } catch (reason) {
      setError(reason instanceof AssessmentApiError ? reason.message : "We could not process your signature.");
      setSubmitting(false);
    }
  };

  if (!details && !error) return <LoadingOverlay label="Loading your legal agreement" />;
  return (
    <section className="page-shell py-10 sm:py-14">
      <Stepper current={1} steps={steps} />
      <div className="mt-8 grid gap-7 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 p-5">
            <StatusBadge status="active">Secure legal agreement</StatusBadge>
            <h1 className="mt-4 text-2xl font-bold text-navy-800">{details?.agreement?.title ?? "Assessment Legal Agreement"}</h1>
            {details?.agreement ? <p className="mt-2 text-sm text-slate-600">Version {details.agreement.version} · Agreement date {details.agreement.displayDate}</p> : null}
          </div>
          {details?.agreement ? <iframe className="h-[72vh] min-h-[640px] w-full bg-slate-100" src={details.agreement.pdfUrl} title="Complete Tax Assessment Plan Legal Service Agreement" /> : <div className="p-6">{error ? <ErrorAlert>{error}</ErrorAlert> : null}</div>}
        </Card>
        <Card className="h-fit xl:sticky xl:top-6">
          <FileCheck2 className="text-gold-600" aria-hidden />
          <h2 className="mt-4 text-xl font-bold text-navy-800">Review and sign</h2>
          <dl className="mt-5 grid gap-3 rounded-xl bg-navy-50 p-4 text-sm">
            <div className="flex justify-between gap-4"><dt>Client</dt><dd className="font-semibold text-right">{details?.clientName ?? "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Assessment year</dt><dd className="font-semibold">{details?.assessmentYear ?? "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Invoice after signing</dt><dd className="font-semibold">{formatServiceAmount()}</dd></div>
          </dl>
          <div className="mt-6 grid gap-5">
            <Checkbox checked={accepted} onChange={(event) => setAccepted(event.target.checked)} label={details?.agreement?.acknowledgementText ?? "I have read and agree to the complete agreement."} />
            <Input label="Type your full legal name" value={typedName} onChange={(event) => setTypedName(event.target.value)} autoComplete="name" placeholder={details?.clientName} />
            {error ? <ErrorAlert>{error}</ErrorAlert> : null}
            <Button disabled={!accepted || typedName.trim().length < 2 || submitting || !details?.agreement} onClick={submit} type="button">
              {submitting ? "Signing and creating invoice..." : "Sign Agreement & Create Invoice"}
            </Button>
            <p className="flex gap-2 text-xs leading-5 text-slate-500"><LockKeyhole className="mt-0.5 shrink-0" size={14} aria-hidden /> Your IP address, browser, timestamp, template hashes, and typed signature are retained as evidence for seven years.</p>
          </div>
        </Card>
      </div>
      {submitting ? <LoadingOverlay label="Saving your signature and preparing your QuickBooks invoice" /> : null}
    </section>
  );
}