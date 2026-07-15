"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, Mail, RefreshCw } from "lucide-react";
import {
  AssessmentApiError,
  loadPaymentStatus,
  refreshPaymentStatus,
  resendInvoiceEmail,
  startPaidAccountSetup,
  type PaymentStatusResponse
} from "@/services/assessment-api";
import { Button, Card, ErrorAlert, LoadingOverlay, StatusBadge, Stepper } from "@/components/ui";

const steps = ["Start", "Agreement & invoice", "Payment & account", "Profile & documents"] as const;

const formatMoney = (amount?: number, currency = "USD") =>
  typeof amount === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)
    : "-";

const isPending = (status?: string) => status === "PAYMENT_PENDING" || status === "PAYMENT_VERIFYING";
const isVerifiedForSetup = (details: PaymentStatusResponse | null) =>
  Boolean(
    details?.accountCreationAllowed &&
      (details.status === "PAID_VERIFIED" || details.status === "ACCOUNT_INVITED")
  );

const secondsUntil = (timestamp?: string) =>
  timestamp ? Math.max(0, Math.ceil((new Date(timestamp).getTime() - Date.now()) / 1000)) : 0;

const formatCooldown = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${remainder.toString().padStart(2, "0")}` : `${remainder}s`;
};

export function PaymentStatusClient({ token }: { token: string }) {
  const router = useRouter();
  const [details, setDetails] = useState<PaymentStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resending, setResending] = useState(false);
  const [startingSetup, setStartingSetup] = useState(false);
  const [autoStartedSetup, setAutoStartedSetup] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNoticeIsCooldown, setResendNoticeIsCooldown] = useState(false);

  const paid = isVerifiedForSetup(details);

  const badge = useMemo(() => {
    if (details?.status === "PAID_VERIFIED" || details?.status === "ACCOUNT_INVITED") {
      return { status: "complete" as const, label: "Payment verified" };
    }
    if (isPending(details?.status)) {
      return { status: "pending" as const, label: "Awaiting QuickBooks payment" };
    }
    return { status: "active" as const, label: details?.status ?? "Loading" };
  }, [details?.status]);

  useEffect(() => {
    let mounted = true;
    loadPaymentStatus(token)
      .then((result) => {
        if (mounted) {
          setDetails(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (mounted) {
          setError(
            caught instanceof AssessmentApiError
              ? caught.message
              : "We could not load payment status."
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    if (!isPending(details?.status)) return;
    const interval = window.setInterval(() => {
      refreshPaymentStatus(token).then(setDetails).catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [details?.status, token]);

  useEffect(() => {
    setResendCooldown(secondsUntil(details?.invoiceEmailResendAvailableAt));
  }, [details?.invoiceEmailResendAvailableAt]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = window.setInterval(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [resendCooldown]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      setDetails(await refreshPaymentStatus(token));
    } catch (caught) {
      setError(
        caught instanceof AssessmentApiError
          ? caught.message
          : "We could not refresh payment status."
      );
    } finally {
      setRefreshing(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setError(null);
    setResendMessage(null);
    setResendNoticeIsCooldown(false);
    try {
      const result = await resendInvoiceEmail(token);
      setResendCooldown(result.retryAfterSeconds);
      setResendMessage("Invoice email resent. Please check your inbox and spam folder.");
    } catch (caught) {
      if (caught instanceof AssessmentApiError && caught.statusCode === 429) {
        setResendCooldown(caught.retryAfterSeconds ?? 60);
        setResendNoticeIsCooldown(true);
        setResendMessage("An invoice email was sent recently. You can resend it when the countdown finishes.");
      } else {
        setError(
          caught instanceof AssessmentApiError
            ? caught.message
            : "We could not resend the invoice email."
        );
      }
    } finally {
      setResending(false);
    }
  };

  const proceedToSetup = useCallback(async () => {
    setStartingSetup(true);
    setError(null);
    setResendMessage(null);
    try {
      const result = await startPaidAccountSetup(token);
      router.push(result.nextUrl as Route);
    } catch (caught) {
      setError(
        caught instanceof AssessmentApiError
          ? caught.message
          : "We could not start profile setup."
      );
      setStartingSetup(false);
    }
  }, [router, token]);

  useEffect(() => {
    if (!paid || startingSetup || autoStartedSetup) return;
    setAutoStartedSetup(true);
    void proceedToSetup();
  }, [autoStartedSetup, paid, proceedToSetup, startingSetup]);

  if (loading) return <LoadingOverlay label="Loading payment status" />;

  return (
    <div className="page-shell py-10">
      <Stepper current={2} steps={steps} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
          <h1 className="mt-4 text-3xl font-bold text-navy-800">
            Invoice & payment status
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            We verify payment directly against QuickBooks. Profile setup unlocks only after the
            exact invoice shows a zero balance.
          </p>

          {error ? (
            <div className="mt-5">
              <ErrorAlert>{error}</ErrorAlert>
            </div>
          ) : null}
          {resendMessage ? (
            <p className={`mt-5 rounded-xl p-4 text-sm ${resendNoticeIsCooldown ? "border border-amber-200 bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-900"}`}>
              {resendMessage}
            </p>
          ) : null}

          {!paid && isPending(details?.status) ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
              <p className="font-semibold">Action required: pay your QuickBooks invoice</p>
              <p className="mt-2 text-sm leading-6">
                Please check the invoice sent to your email inbox and spam folder, open the
                QuickBooks invoice, and complete the payment there. After paying, revisit this same
                page or click <span className="font-semibold">Refresh payment status</span>. Once
                QuickBooks shows a zero balance, we&apos;ll automatically continue you to account
                setup and your assessment dashboard.
              </p>
            </div>
          ) : null}

          {paid ? (
            <div className="mt-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <CheckCircle2 aria-hidden className="mt-0.5 shrink-0" size={20} />
              <div>
                <p className="font-semibold">Payment verified</p>
                <p className="mt-1 text-sm">
                  We&apos;re preparing your account setup and dashboard automatically. If you return later,
                  this same secure status link will resume the flow.
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            {paid ? (
              <>
                <Button onClick={proceedToSetup} disabled={startingSetup}>
                  <ArrowRight aria-hidden className="mr-2" size={17} />
                  {startingSetup ? "Preparing dashboard..." : "Continue to dashboard"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/" as Route)}
                  disabled={startingSetup}
                >
                  <Clock3 aria-hidden className="mr-2" size={17} />
                  I&apos;ll do this later
                </Button>
              </>
            ) : (
              <>
                <Button onClick={refresh} disabled={refreshing || resending}>
                  <RefreshCw
                    aria-hidden
                    className={refreshing ? "mr-2 animate-spin" : "mr-2"}
                    size={17}
                  />
                  {refreshing ? "Checking..." : "Refresh payment status"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resend}
                  disabled={refreshing || resending || resendCooldown > 0 || !details?.invoiceNumber}
                >
                  <Mail aria-hidden className="mr-2" size={17} />
                  {resending
                    ? "Resending..."
                    : resendCooldown > 0
                      ? `Resend in ${formatCooldown(resendCooldown)}`
                      : "Resend invoice email"}
                </Button>
              </>
            )}
          </div>

          {paid ? (
            <p className="mt-4 text-sm text-slate-500">
              Choosing later will not cancel your assessment. Keep this secure status link so you
              can come back to setup.
            </p>
          ) : null}
          {isPending(details?.status) ? (
            <div className="mt-4 space-y-2 text-sm text-slate-500">
              {resendCooldown > 0 ? (
                <p>To prevent duplicate QuickBooks emails, resend unlocks automatically when the countdown ends.</p>
              ) : null}
              <p>
                You can safely close this page after paying from the invoice email. Return using this
                same secure link, or leave it open and it will check automatically every 20 seconds.
              </p>
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-xl font-bold text-navy-800">QuickBooks invoice</h2>
          <dl className="mt-5 grid gap-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Invoice #</dt>
              <dd className="font-semibold text-navy-800">{details?.invoiceNumber ?? "Pending"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Invoice amount</dt>
              <dd className="font-semibold">
                {formatMoney(details?.invoiceAmount, details?.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Current balance</dt>
              <dd className="font-semibold">
                {formatMoney(details?.invoiceBalance, details?.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Last checked</dt>
              <dd className="text-right font-semibold">
                {details?.lastStatusCheckedAt
                  ? new Date(details.lastStatusCheckedAt).toLocaleString()
                  : "Not checked yet"}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
