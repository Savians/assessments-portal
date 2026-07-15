"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, KeyRound, MailCheck, RotateCcw } from "lucide-react";
import { confirmPortalPasswordReset, requestPortalPasswordReset } from "@/services/portal-auth";
import { Button, Card, ErrorAlert, Input, LoadingOverlay, StatusBadge } from "@/components/ui";

type RecoveryPhase = "EMAIL" | "CODE" | "COMPLETE";

const passwordIssue = (password: string): string | null => {
  if (password.length < 12) return "Use at least 12 characters.";
  if (!/[a-z]/.test(password)) return "Include a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Include an uppercase letter.";
  if (!/[0-9]/.test(password)) return "Include a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Include a special character.";
  return null;
};

export function ForgotPasswordClient({ initialEmail = "", returnTo = "/portal/dashboard" }: { initialEmail?: string; returnTo?: string }) {
  const [email, setEmail] = useState(initialEmail.trim().toLowerCase());
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phase, setPhase] = useState<RecoveryPhase>("EMAIL");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const passwordValidation = useMemo(() => passwordIssue(password), [password]);
  const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/portal/dashboard";

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await requestPortalPasswordReset(email);
      setPhase("CODE");
      setCooldown(60);
      setMessage("If a verified Savians account exists for that email, a single-use reset code has been sent. Check your inbox and spam folder.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not send a password reset code.");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (passwordValidation) {
      setError(passwordValidation);
      return;
    }
    if (password !== confirmPassword) {
      setError("The two password entries do not match.");
      return;
    }
    setLoading(true);
    try {
      await confirmPortalPasswordReset({ email, confirmationCode: code, newPassword: password });
      setPhase("COMPLETE");
      setCode("");
      setPassword("");
      setConfirmPassword("");
      setMessage("Your password has been changed. You can now sign in with the new password.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not reset your password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-shell min-h-[70vh] py-14">
      {loading ? <LoadingOverlay label={phase === "EMAIL" ? "Sending reset code" : "Resetting password"} /> : null}
      <Card className="mx-auto max-w-xl">
        <StatusBadge status={phase === "COMPLETE" ? "complete" : "active"}>Secure account recovery</StatusBadge>
        <h1 className="mt-5 text-3xl font-bold text-navy-800">
          {phase === "COMPLETE" ? "Password reset complete" : "Forgot your password?"}
        </h1>
        <p className="mt-3 leading-7 text-slate-600">
          {phase === "EMAIL"
            ? "Enter the email used for your Savians assessment account. We’ll send a time-limited, single-use reset code."
            : phase === "CODE"
              ? "Enter the latest eight-digit code from your email and choose a new password. Requesting another code invalidates the previous one."
              : "Your old password no longer works. Continue to the dashboard and sign in with your new password."}
        </p>

        {error ? <div className="mt-5"><ErrorAlert>{error}</ErrorAlert></div> : null}
        {message ? (
          <div className="mt-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
            {phase === "COMPLETE" ? <CheckCircle2 aria-hidden className="mt-0.5 shrink-0" size={18} /> : <MailCheck aria-hidden className="mt-0.5 shrink-0" size={18} />}
            <p>{message}</p>
          </div>
        ) : null}

        {phase === "EMAIL" ? (
          <form className="mt-7 grid gap-5" onSubmit={sendCode}>
            <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value.trim())} required />
            <Button type="submit" disabled={loading || !email}>
              <MailCheck aria-hidden className="mr-2" size={17} />
              Send password reset code
            </Button>
          </form>
        ) : null}

        {phase === "CODE" ? (
          <form className="mt-7 grid gap-5" onSubmit={resetPassword}>
            <div className="rounded-xl bg-navy-50 p-4 text-sm text-navy-800">
              Resetting the password for <strong>{email}</strong>. The single-use code expires after 15 minutes.
            </div>
            <Input label="Reset code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 12))} required />
            <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} error={password ? passwordValidation ?? undefined : undefined} required />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} error={confirmPassword && password !== confirmPassword ? "Passwords do not match." : undefined} required />
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              Use 12 or more characters with uppercase, lowercase, a number, and a special character. Do not reuse a password from another website.
            </p>
            <Button type="submit" disabled={loading || code.length !== 8 || Boolean(passwordValidation) || password !== confirmPassword}>
              <KeyRound aria-hidden className="mr-2" size={17} />
              Reset password
            </Button>
            <Button type="button" variant="outline" onClick={() => void sendCode()} disabled={loading || cooldown > 0}>
              <RotateCcw aria-hidden className="mr-2" size={17} />
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend reset code"}
            </Button>
            <button className="text-sm font-semibold text-slate-600 underline underline-offset-4" type="button" onClick={() => { setPhase("EMAIL"); setCode(""); setError(null); setMessage(null); }}>
              Use a different email
            </button>
          </form>
        ) : null}

        {phase === "COMPLETE" ? (
          <div className="mt-7 grid gap-4">
            <a className="focus-ring inline-flex min-h-11 items-center justify-center rounded-lg bg-navy-800 px-5 py-2.5 text-sm font-semibold text-white" href={safeReturnTo === "/portal/dashboard" ? `/portal/dashboard?email=${encodeURIComponent(email)}` : safeReturnTo}>
              {safeReturnTo === "/portal/dashboard" ? "Sign in to dashboard" : "Return to account setup"}
            </a>
          </div>
        ) : null}

        {phase !== "COMPLETE" ? (
          <Link className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-navy-700" href="/portal/dashboard">
            <ArrowLeft aria-hidden size={16} /> Back to sign in
          </Link>
        ) : null}
      </Card>
    </section>
  );
}
