import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes
} from "react";
import { forwardRef } from "react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" }) {
  return (
    <button
      className={cn(
        "focus-ring inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-navy-800 text-white hover:bg-navy-700",
        variant === "outline" && "border border-navy-800 bg-white text-navy-800 hover:bg-navy-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className
      )}
      {...props}
    />
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }
>(function Input({ label, error, className, ...props }, ref) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <input
        ref={ref}
        className={cn(
          "focus-ring min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900",
          error && "border-red-500",
          className
        )}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </label>
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode; error?: string }
>(function Select({ label, children, className, error, ...props }, ref) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <select
        ref={ref}
        className={cn(
          "focus-ring min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base",
          error && "border-red-500",
          className
        )}
        aria-invalid={Boolean(error)}
        {...props}
      >
        {children}
      </select>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </label>
  );
});

export const Checkbox = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }
>(function Checkbox({ label, error, ...props }, ref) {
  return (
    <div>
      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input
          ref={ref}
          className="focus-ring mt-1 size-4 rounded border-slate-300"
          type="checkbox"
          aria-invalid={Boolean(error)}
          {...props}
        />
        <span>{label}</span>
      </label>
      {error ? <span className="mt-2 block text-sm text-red-700">{error}</span> : null}
    </div>
  );
});

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white p-6 shadow-card", className)}>
      {children}
    </section>
  );
}

const statusStyles = {
  pending: "bg-amber-100 text-amber-900",
  active: "bg-blue-100 text-blue-900",
  complete: "bg-emerald-100 text-emerald-900",
  error: "bg-red-100 text-red-900"
} as const;

export function StatusBadge({
  children,
  status = "pending"
}: {
  children: ReactNode;
  status?: keyof typeof statusStyles;
}) {
  return (
    <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", statusStyles[status])}>
      {children}
    </span>
  );
}

export function Stepper({ current, steps }: { current: number; steps: readonly string[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-4" aria-label="Assessment progress">
      {steps.map((step, index) => (
        <li className="flex items-center gap-2 text-sm" key={step}>
          <span
            className={cn(
              "grid size-7 place-items-center rounded-full border text-xs font-bold",
              index <= current ? "border-navy-800 bg-navy-800 text-white" : "border-slate-300 text-slate-500"
            )}
          >
            {index < current ? <Check aria-hidden size={14} /> : index + 1}
          </span>
          <span className={index <= current ? "font-medium text-navy-800" : "text-slate-500"}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
      <AlertCircle aria-hidden className="mt-0.5 shrink-0" size={18} />
      <div>{children}</div>
    </div>
  );
}

export function LoadingOverlay({ label = "Loading" }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-900/40 backdrop-blur-sm" role="status">
      <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 text-navy-800 shadow-card">
        <LoaderCircle aria-hidden className="animate-spin" size={20} />
        <span className="font-medium">{label}</span>
      </div>
    </div>
  );
}
