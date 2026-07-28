"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  assessmentStartSchema,
  type AssessmentStartFormValues
} from "@/lib/assessment-start-schema";
import { AssessmentApiError, startAssessment } from "@/services/assessment-api";
import { Button, Checkbox, ErrorAlert, Input } from "@/components/ui";

export function AssessmentStartForm() {
  const router = useRouter();
  const [existingAccountNextUrl, setExistingAccountNextUrl] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting }
  } = useForm<AssessmentStartFormValues>({
    resolver: zodResolver(assessmentStartSchema),
    defaultValues: {
      firstName: "",
      middleName: "",
      lastName: "",
      email: "",
      phone: "",
      consentAccepted: false
    }
  });

  const onSubmit = async (values: AssessmentStartFormValues) => {
    try {
      const result = await startAssessment(values);
      if (result.accountExists && !result.resumed) {
        setExistingAccountNextUrl(result.nextUrl);
        return;
      }
      router.push(result.nextUrl as Route);
    } catch (error) {
      const message =
        error instanceof AssessmentApiError
          ? error.message
          : "We could not start your assessment. Please try again.";
      setError("root", { message });
    }
  };

  return (
    <form className="grid gap-7" noValidate onSubmit={handleSubmit(onSubmit)}>
      {errors.root?.message ? <ErrorAlert>{errors.root.message}</ErrorAlert> : null}
      {existingAccountNextUrl ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950" role="status">
          <p className="font-bold">An existing Savians account was found for this email.</p>
          <p className="mt-1">We checked before agreement and payment. Continue using this email; your current password will not be changed. After payment, you will sign in to connect this assessment to the same account.</p>
          <Button className="mt-4" type="button" onClick={() => router.push(existingAccountNextUrl as Route)}>
            Continue to Agreement
          </Button>
          <button className="ml-4 font-semibold text-navy-700 underline underline-offset-4" type="button" onClick={() => setExistingAccountNextUrl(null)}>
            Use a different email
          </button>
        </div>
      ) : null}

      <fieldset className="grid gap-5">
        <legend className="mb-4 text-xl font-bold text-navy-800">Your information</legend>
        <div className="grid gap-5 md:grid-cols-3">
          <Input
            label="First name"
            required
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...register("firstName")}
          />
          <Input
            label="Middle name"
            autoComplete="additional-name"
            error={errors.middleName?.message}
            {...register("middleName")}
          />
          <Input
            label="Last name"
            required
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register("lastName")}
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            label="Phone"
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(832) 555-1212"
            error={errors.phone?.message}
            {...register("phone")}
          />
          <Input
            label="Email address"
            required
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
        </div>
      </fieldset>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <Checkbox
          label="I consent to Savians Tax Advisors using this information to create or resume my annual Tax Assessment and contact me about the next onboarding step."
          required
          error={errors.consentAccepted?.message}
          {...register("consentAccepted")}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-6 text-slate-500">
          No QuickBooks customer or invoice is created until you review and sign the Assessment
          Legal Agreement.
        </p>
        <Button className="min-w-48" disabled={isSubmitting || Boolean(existingAccountNextUrl)} type="submit">
          {isSubmitting ? "Checking account..." : existingAccountNextUrl ? "Account found" : "Continue to Agreement"}
        </Button>
      </div>
    </form>
  );
}
