"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, MailCheck } from "lucide-react";
import { AssessmentApiError, confirmAccountSetup, startAccountSetup, validateAccountInvite, type AccountInviteDetails } from "@/services/assessment-api";
import { signInToPortal } from "@/services/portal-auth";
import { Button, Card, ErrorAlert, Input, LoadingOverlay, StatusBadge, Stepper } from "@/components/ui";

const steps = ["Start", "Agreement & invoice", "Payment & account", "Profile & documents"] as const;

export function AccountSetupClient({ inviteToken }: { inviteToken: string }) {
  const [details, setDetails] = useState<AccountInviteDetails | null>(null);
  const [password, setPassword] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [phase, setPhase] = useState<"PASSWORD" | "CONFIRM" | "DONE">("PASSWORD");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    validateAccountInvite(inviteToken)
      .then((result) => { if (mounted) { setDetails(result); setError(null); } })
      .catch((caught) => { if (mounted) setError(caught instanceof AssessmentApiError ? caught.message : "We could not validate this account invite."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [inviteToken]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true); setError(null);
    try {
      await startAccountSetup({ inviteToken, password });
      setPhase("CONFIRM");
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not start account setup.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const result = await confirmAccountSetup({ inviteToken, confirmationCode });
      if (!details?.email) throw new Error("Account email is missing from this setup session.");
      await signInToPortal({ email: details.email, password });
      setPhase("DONE");
      window.setTimeout(() => window.location.assign(result.nextUrl), 1200);
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "Your account was verified, but we could not start the portal session. Please use the same password you set for this Savians account.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingOverlay label="Validating account invite" />;

  return (
    <div className="page-shell py-10">
      <Stepper current={2} steps={steps} />
      <Card className="mx-auto mt-8 max-w-2xl">
        <StatusBadge status={phase === "DONE" ? "complete" : "active"}>Paid account setup</StatusBadge>
        <h1 className="mt-4 text-3xl font-bold text-navy-800">Create your Savians account</h1>
        {details ? (
          <p className="mt-3 leading-7 text-slate-600">
            This invite is for <strong>{details.clientName}</strong> ({details.email}) for the {details.assessmentYear} assessment.
            It expires on {new Date(details.expiresAt).toLocaleString()}.
          </p>
        ) : null}
        {error ? <div className="mt-5"><ErrorAlert>{error}</ErrorAlert></div> : null}

        {phase === "PASSWORD" ? (
          <form className="mt-7 grid gap-5" onSubmit={start}>
            <Input label="Create password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <p className="rounded-xl bg-navy-50 p-4 text-sm text-navy-800">
              Use at least 12 characters with uppercase, lowercase, a number, and a special character. We’ll send a Savians verification code to your email before portal access is enabled.
            </p>
            <Button type="submit" disabled={submitting || password.length < 12}>
              <KeyRound aria-hidden className="mr-2" size={17} />
              {submitting ? "Creating..." : "Create account"}
            </Button>
          </form>
        ) : null}

        {phase === "CONFIRM" ? (
          <form className="mt-7 grid gap-5" onSubmit={confirm}>
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">Check your email</p>
              <p className="mt-1">Enter the verification code sent to {details?.email ?? "your email"}.</p>
            </div>
            <Input label="Verification code" inputMode="numeric" autoComplete="one-time-code" value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value)} />
            <Button type="submit" disabled={submitting || confirmationCode.trim().length < 4}>
              <MailCheck aria-hidden className="mr-2" size={17} />
              {submitting ? "Verifying..." : "Verify email & finish"}
            </Button>
          </form>
        ) : null}

        {phase === "DONE" ? (
          <div className="mt-7 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            <CheckCircle2 aria-hidden className="mt-0.5 shrink-0" size={20} />
            <div>
            <p className="font-semibold">Account created</p>
              <p className="mt-1 text-sm">Redirecting you to your assessment dashboard.</p>
            </div>
          </div>
        ) : null}
      </Card>
      {submitting ? <LoadingOverlay label="Processing account setup" /> : null}
    </div>
  );
}
