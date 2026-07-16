"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react";
import { Button, Card, ErrorAlert, Input, LoadingOverlay, StatusBadge } from "@/components/ui";
import { getCurrentPortalAccessToken, getPortalIdentity, routeForPortalRole, signInToPortal } from "@/services/portal-auth";

export function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentPortalAccessToken().then((token) => {
      if (token) {
        const destination = routeForPortalRole(getPortalIdentity(token).role);
        if (destination !== "/login") router.replace(destination);
      }
      setLoading(false);
    });
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await signInToPortal({ email, password });
      if (session.identity.role === "UNKNOWN") throw new Error("This account does not have access to the assessment portal.");
      router.replace(routeForPortalRole(session.identity.role));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not sign you in.");
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingOverlay label="Checking secure session" />;
  return (
    <section className="page-shell min-h-[75vh] py-12 sm:py-16">
      <Card className="mx-auto max-w-xl">
        <StatusBadge status="active"><ShieldCheck aria-hidden size={14} /> One secure login</StatusBadge>
        <h1 className="mt-5 text-3xl font-bold text-navy-800">Sign In To Savians Assessments</h1>
        <p className="mt-3 leading-7 text-slate-600">Clients and administrators use this same sign-in. Your account role securely determines which dashboard opens.</p>
        {error ? <div className="mt-5"><ErrorAlert>{error}</ErrorAlert></div> : null}
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <Input label="Email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <div className="grid gap-2 text-sm font-medium text-slate-700">
            <label htmlFor="login-password">Password</label>
            <div className="relative">
              <input
                id="login-password"
                className="focus-ring min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 pr-12 text-base text-slate-900"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="focus-ring absolute inset-y-0 right-1 my-1 grid w-10 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-navy-800"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff aria-hidden size={19} /> : <Eye aria-hidden size={19} />}
              </button>
            </div>
          </div>
          <Button type="submit" disabled={submitting}><LogIn aria-hidden size={17} />{submitting ? "Signing In..." : "Sign In"}</Button>
        </form>
        <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
          <Link className="font-semibold text-navy-700 underline-offset-4 hover:underline" href="/assessment/forgot-password">Forgot password?</Link>
          <Link className="font-semibold text-navy-700 underline-offset-4 hover:underline" href="/assessment/recover">Resume before account setup</Link>
        </div>
      </Card>
    </section>
  );
}
