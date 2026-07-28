"use client";

import Link from "next/link";
import { FormEvent, useEffect, useId, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LogIn, MailCheck, RotateCcw } from "lucide-react";
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
import { Button, Card, cn, ErrorAlert, FieldLabel, Input, LoadingOverlay, StatusBadge, Stepper } from "@/components/ui";
import { ONBOARDING_STEPS } from "@/lib/assessment-flow";
type SetupPhase = "PASSWORD" | "CONFIRM" | "EXISTING" | "DONE";

const passwordIssue = (value: string): string | null => {
  if (value.length < 12) return "Password must be at least 12 characters.";
  if (value.length > 256) return "Password must be no more than 256 characters.";
  if (!/[a-z]/.test(value)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(value)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(value)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must include a special character.";
  return null;
};

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
  error
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete: "new-password" | "current-password";
  error?: string | null;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const action = `${visible ? "Hide" : "Show"} ${label.toLocaleLowerCase("en-US")}`;

  return (
    <div className="grid gap-2 text-sm font-medium text-slate-700">
      <label htmlFor={inputId}><FieldLabel label={label} required /></label>
      <div className="relative">
        <input
          id={inputId}
          aria-label={label}
          className={cn(
            "focus-ring min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 pr-12 text-base text-slate-900",
            error && "border-red-500"
          )}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          required
        />
        <button
          className="focus-ring absolute inset-y-1 right-1 inline-grid w-10 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-navy-800"
          type="button"
          aria-label={action}
          aria-pressed={visible}
          title={action}
          onClick={onToggle}
        >
          {visible ? <EyeOff aria-hidden size={19} /> : <Eye aria-hidden size={19} />}
        </button>
      </div>
      {error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}

export function AccountSetupClient({ inviteToken }: { inviteToken: string }) {
  const [details, setDetails] = useState<AccountInviteDetails | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
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
    const exactPasswordError = passwordIssue(password);
    const exactConfirmPasswordError = !confirmPassword
      ? "Please confirm your password."
      : confirmPassword !== password
        ? "Passwords do not match."
        : null;
    setPasswordError(exactPasswordError);
    setConfirmPasswordError(exactConfirmPasswordError);
    if (exactPasswordError || exactConfirmPasswordError) {
      setError(exactPasswordError ?? exactConfirmPasswordError);
      setMessage(null);
      return;
    }

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
        setConfirmPassword("");
        setPasswordVisible(false);
        setConfirmPasswordVisible(false);
        setResendCooldown(60);
        setMessage("A fresh verification code was sent to your email.");
      }
    } catch (caught) {
      if (caught instanceof AssessmentApiError) {
        const exactIssue = caught.issues?.find((issue) => issue.path === "password")?.message;
        setPasswordError(exactIssue ?? null);
        setError(exactIssue ?? caught.message);
      } else {
        setError("We could not start account setup.");
      }
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
      <Stepper current={2} steps={ONBOARDING_STEPS} />
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
        {details ? (
          <div className="mt-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900" role="status">
            <CheckCircle2 aria-hidden className="mt-0.5 shrink-0 text-emerald-700" size={20} />
            <div>
              <p className="font-semibold">Payment successful</p>
              <p className="mt-1 text-sm leading-6">
                Your payment has been verified. Please spend a few minutes setting up your secure
                account, completing your profile, and uploading the necessary documents. After
                your account is set up, you can sign in and return at any time.
              </p>
            </div>
          </div>
        ) : null}
        {error ? <div className="mt-5"><ErrorAlert>{error}</ErrorAlert></div> : null}
        {message ? <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p> : null}

        {phase === "PASSWORD" && details ? (
          <form className="mt-7 grid gap-5" noValidate onSubmit={start}>
            <PasswordField
              label="Create password"
              value={password}
              onChange={(value) => {
                setPassword(value);
                setPasswordError(null);
                setConfirmPasswordError(null);
                setError(null);
              }}
              visible={passwordVisible}
              onToggle={() => setPasswordVisible((current) => !current)}
              autoComplete="new-password"
              error={passwordError}
            />
            <PasswordField
              label="Confirm password"
              value={confirmPassword}
              onChange={(value) => {
                setConfirmPassword(value);
                setConfirmPasswordError(null);
                setError(null);
              }}
              visible={confirmPasswordVisible}
              onToggle={() => setConfirmPasswordVisible((current) => !current)}
              autoComplete="new-password"
              error={confirmPasswordError}
            />
            <p className="rounded-xl bg-navy-50 p-4 text-sm text-navy-800">
              Use at least 12 characters with uppercase, lowercase, a number, and a special character. We&apos;ll email a single-use verification code before portal access is enabled. If you already have a Savians account, enter its existing password instead.
            </p>
            <Button type="submit" disabled={submitting}>
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
            <PasswordField
              label="Existing password"
              value={password}
              onChange={setPassword}
              visible={passwordVisible}
              onToggle={() => setPasswordVisible((current) => !current)}
              autoComplete="current-password"
            />
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
