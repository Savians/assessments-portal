"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LogIn, MailCheck, RotateCcw } from "lucide-react";
import {
  AssessmentApiError,
  claimExistingAccount,
  confirmAccountSetup,
  resendAccountVerificationCode,
  startAccountSetup,
  validateAccountInvite,
  type AccountInviteDetails
} from "@/services/assessment-api";
import { signInToPortal } from "@/services/portal-auth";
import { Button, Card, ErrorAlert, Input, LoadingOverlay, StatusBadge, Stepper } from "@/components/ui";

const steps = ["Start", "Agreement & invoice", "Payment & account", "Profile & documents"] as const;
type SetupPhase = "PASSWORD" | "CONFIRM" | "EXISTING" | "DONE";

export function AccountSetupClient({ inviteToken }: { inviteToken: string }) {
  const [details, setDetails] = useState<AccountInviteDetails | null>(null);
  const [password, setPassword] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [phase, setPhase] = useState<SetupPhase>("PASSWORD");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    validateAccountInvite(inviteToken)
      .then((result) => {
        if (!mounted) return;
        setDetails(result);
        setError(null);
        if (result.status === "ACCOUNT_CREATED") {
          setPhase("DONE");
          setMessage("This account setup is already complete. Continue to your dashboard to sign in.");
        } else if (result.accountExists) {
          setPhase("EXISTING");
          setMessage("Your existing Savians account was identified before payment. Sign in with its current password to connect this assessment.");
        }
      })
      .catch((caught) => {
        if (mounted) setError(caught instanceof AssessmentApiError ? caught.message : "We could not validate this account invite.");
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [inviteToken]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function signInAndClaimExistingAccount() {
    if (!details?.email) throw new Error("Account email is missing from this setup session.");
    const session = await signInToPortal({ email: details.email, password });
    const result = await claimExistingAccount({ inviteToken, accessToken: session.accessToken });
    setPhase("DONE");
    setMessage("Your existing Savians account is now connected to this assessment.");
    window.setTimeout(() => window.location.assign(result.nextUrl), 900);
  }

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await startAccountSetup({ inviteToken, password });
      if (result.status === "EXISTING_ACCOUNT") {
        setPhase("EXISTING");
        try {
          await signInAndClaimExistingAccount();
        } catch {
          setError("A Savians account already exists for this email. Enter its existing password, or use Forgot Password. Your current password has not been changed.");
        }
      } else {
        setPhase("CONFIRM");
        setResendCooldown(60);
        setMessage("A fresh verification code was sent to your email.");
      }
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not start account setup.");
    } finally {
      setSubmitting(false);
    }
  };

  const completeExisting = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await signInAndClaimExistingAccount();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not sign in to your existing account.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await confirmAccountSetup({ inviteToken, confirmationCode });
      setPhase("DONE");
      setMessage("Your email is verified and your Savians account is ready.");
      if (!details?.email) throw new Error("Account email is missing from this setup session.");
      try {
        await signInToPortal({ email: details.email, password });
        window.setTimeout(() => window.location.assign(result.nextUrl), 900);
      } catch {
        setError("Your account was created successfully, but automatic sign-in did not complete. Continue to the dashboard and sign in, or use Forgot Password.");
      }
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not verify that code. Request a new code and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    setResending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await resendAccountVerificationCode(inviteToken);
      setConfirmationCode("");
      setResendCooldown(result.retryAfterSeconds);
      setMessage("A new verification code was sent. Only the latest code will work.");
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not resend the verification code.");
    } finally {
      setResending(false);
    }
  };

  if (loading) return <LoadingOverlay label="Validating account invite" />;

  return (
    <div className="page-shell py-10">
      <Stepper current={2} steps={steps} />
      <Card className="mx-auto mt-8 max-w-2xl">
        <StatusBadge status={phase === "DONE" ? "complete" : "active"}>Paid account setup</StatusBadge>
        <h1 className="mt-4 text-3xl font-bold text-navy-800">
          {phase === "EXISTING" ? "Sign in to your Savians account" : "Create your Savians account"}
        </h1>
        {details ? (
          <p className="mt-3 leading-7 text-slate-600">
            This invite is for <strong>{details.clientName}</strong> ({details.email}) for the {details.assessmentYear} assessment.
            It expires on {new Date(details.expiresAt).toLocaleString()}.
          </p>
        ) : null}
        {error ? <div className="mt-5"><ErrorAlert>{error}</ErrorAlert></div> : null}
        {message ? <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p> : null}

        {phase === "PASSWORD" && details ? (
          <form className="mt-7 grid gap-5" onSubmit={start}>
            <Input label="Create password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <p className="rounded-xl bg-navy-50 p-4 text-sm text-navy-800">
              Use at least 12 characters with uppercase, lowercase, a number, and a special character. We&apos;ll email a single-use verification code before portal access is enabled. If you already have a Savians account, enter its existing password instead.
            </p>
            <Button type="submit" disabled={submitting || password.length < 12}>
              <KeyRound aria-hidden className="mr-2" size={17} />
              {submitting ? "Preparing account..." : "Continue securely"}
            </Button>
          </form>
        ) : null}

        {phase === "EXISTING" ? (
          <form className="mt-7 grid gap-5" onSubmit={completeExisting}>
            <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
              <p className="font-semibold">Your reusable account was found</p>
              <p className="mt-1">Sign in with the password you already use. This assessment will then be connected to the same account.</p>
            </div>
            <Input label="Existing password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <Button type="submit" disabled={submitting || !password}>
              <LogIn aria-hidden className="mr-2" size={17} />
              {submitting ? "Signing in..." : "Sign in and continue"}
            </Button>
            <Link className="text-center text-sm font-semibold text-navy-700 underline underline-offset-4" href={`/assessment/forgot-password?email=${encodeURIComponent(details?.email ?? "")}&returnTo=${encodeURIComponent(`/assessment/account/setup/${inviteToken}`)}`}>
              Forgot Password?
            </Link>
          </form>
        ) : null}

        {phase === "CONFIRM" ? (
          <form className="mt-7 grid gap-5" onSubmit={confirm}>
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">Check your email</p>
              <p className="mt-1">Enter the latest verification code sent to {details?.email ?? "your email"}. Codes expire after 15 minutes.</p>
            </div>
            <Input label="Verification code" inputMode="numeric" autoComplete="one-time-code" value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value.replace(/\D/g, "").slice(0, 12))} required />
            <Button type="submit" disabled={submitting || confirmationCode.trim().length < 4}>
              <MailCheck aria-hidden className="mr-2" size={17} />
              {submitting ? "Verifying..." : "Verify email & finish"}
            </Button>
            <Button type="button" variant="outline" onClick={resendCode} disabled={resending || resendCooldown > 0}>
              <RotateCcw aria-hidden className="mr-2" size={17} />
              {resending ? "Sending..." : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend verification code"}
            </Button>
          </form>
        ) : null}

        {phase === "DONE" ? (
          <div className="mt-7 grid gap-5">
            <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <CheckCircle2 aria-hidden className="mt-0.5 shrink-0" size={20} />
              <div>
                <p className="font-semibold">Account setup complete</p>
                <p className="mt-1 text-sm">Continue to your assessment dashboard. You may be asked to sign in if this browser does not already have your secure session.</p>
              </div>
            </div>
            <Link className="focus-ring inline-flex min-h-11 items-center justify-center rounded-lg bg-navy-800 px-5 py-2.5 text-sm font-semibold text-white" href="/portal/dashboard">
              Continue to dashboard
            </Link>
            <Link className="text-center text-sm font-semibold text-navy-700 underline underline-offset-4" href={`/assessment/forgot-password?email=${encodeURIComponent(details?.email ?? "")}`}>
              Forgot Password?
            </Link>
          </div>
        ) : null}
      </Card>
      {(submitting || resending) ? <LoadingOverlay label={resending ? "Sending a new verification code" : "Processing account setup"} /> : null}
    </div>
  );
}
