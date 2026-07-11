"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  assessmentStartSchema,
  clientTypeOptions,
  incomeRangeOptions,
  taxPaidRangeOptions,
  type AssessmentStartFormValues
} from "@/lib/assessment-start-schema";
import { AssessmentApiError, startAssessment } from "@/services/assessment-api";
import { Button, Checkbox, ErrorAlert, Input, Select } from "@/components/ui";

const states = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
] as const;

export function AssessmentStartForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting }
  } = useForm<AssessmentStartFormValues>({
    resolver: zodResolver(assessmentStartSchema),
    defaultValues: {
      firstName: "",
      middleName: "",
      lastName: "",
      dateOfBirth: "",
      email: "",
      phone: "",
      clientType: "INDIVIDUAL",
      businessName: "",
      state: "",
      incomeRange: "",
      estimatedTaxPaidRange: "",
      consentAccepted: false
    }
  });

  const clientType = watch("clientType");
  const showBusinessName = clientType === "BUSINESS_OWNER" || clientType === "OTHER";

  const onSubmit = async (values: AssessmentStartFormValues) => {
    try {
      const result = await startAssessment(values);
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

      <fieldset className="grid gap-5">
        <legend className="mb-4 text-xl font-bold text-navy-800">Your information</legend>
        <div className="grid gap-5 md:grid-cols-3">
          <Input
            label="First name *"
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
            label="Last name *"
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register("lastName")}
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            label="Date of birth *"
            type="date"
            autoComplete="bday"
            max={new Date().toISOString().slice(0, 10)}
            error={errors.dateOfBirth?.message}
            {...register("dateOfBirth")}
          />
          <Input
            label="Phone *"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(832) 555-1212"
            error={errors.phone?.message}
            {...register("phone")}
          />
        </div>
        <Input
          label="Email address *"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
      </fieldset>

      <fieldset className="grid gap-5 border-t border-slate-200 pt-7">
        <legend className="mb-4 text-xl font-bold text-navy-800">Assessment context</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Select
            label="Client type *"
            error={errors.clientType?.message}
            {...register("clientType")}
          >
            {clientTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select label="State *" error={errors.state?.message} {...register("state")}>
            <option value="">Select state</option>
            {states.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Select>
        </div>
        {showBusinessName ? (
          <Input
            label="Business name *"
            autoComplete="organization"
            error={errors.businessName?.message}
            {...register("businessName")}
          />
        ) : null}
        <div className="grid gap-5 md:grid-cols-2">
          <Select
            label="Estimated annual income"
            error={errors.incomeRange?.message}
            {...register("incomeRange")}
          >
            <option value="">Prefer not to say</option>
            {incomeRangeOptions.map((range) => (
              <option key={range} value={range}>
                {range}
              </option>
            ))}
          </Select>
          <Select
            label="Estimated annual tax paid"
            error={errors.estimatedTaxPaidRange?.message}
            {...register("estimatedTaxPaidRange")}
          >
            <option value="">Prefer not to say</option>
            {taxPaidRangeOptions.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </Select>
        </div>
      </fieldset>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <Checkbox
          label="I consent to Savians Tax Advisors using this information to create or resume my annual Tax Assessment and contact me about the next onboarding step. *"
          error={errors.consentAccepted?.message}
          {...register("consentAccepted")}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-6 text-slate-500">
          No QuickBooks customer or invoice is created until you review and sign the Assessment
          Legal Agreement.
        </p>
        <Button className="min-w-48" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving..." : "Continue to Agreement"}
        </Button>
      </div>
    </form>
  );
}

