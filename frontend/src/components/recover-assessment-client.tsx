"use client";

import { FormEvent, useState } from "react";
import { MailCheck, RotateCcw } from "lucide-react";
import { AssessmentApiError, recoverAssessment } from "@/services/assessment-api";
import { Button, Card, ErrorAlert, Input, LoadingOverlay, StatusBadge } from "@/components/ui";

export function RecoverAssessmentClient() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await recoverAssessment({ email });
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not send the resume link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-shell min-h-[65vh] py-14">
      {loading ? <LoadingOverlay label="Sending resume link" /> : null}
      <Card className="mx-auto max-w-2xl">
        <StatusBadge status="active">Resume assessment</StatusBadge>
        <h1 className="mt-5 text-3xl font-bold text-navy-800">Sign In / Resume Assessment</h1>
        <p className="mt-4 leading-7 text-slate-600">
          Enter the email you used to start the assessment. If an assessment exists, we’ll email
          a secure link that resumes exactly where you left off.
        </p>
        {error ? <div className="mt-5"><ErrorAlert>{error}</ErrorAlert></div> : null}
        {message ? (
          <div className="mt-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <MailCheck aria-hidden className="mt-0.5 shrink-0" size={18} />
            <p>{message}</p>
          </div>
        ) : null}
        <form className="mt-7 grid gap-5" onSubmit={submit}>
          <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <Button type="submit" disabled={loading || !email}>
            <RotateCcw aria-hidden size={17} />
            Send Secure Resume Link
          </Button>
        </form>
      </Card>
    </section>
  );
}
