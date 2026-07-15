import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { AppProviders } from "@/providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: "Secure onboarding for the annual Savians Tax Assessment."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <header className="border-b border-slate-200 bg-white">
            <div className="page-shell flex min-h-16 items-center justify-between gap-4">
              <Link className="focus-ring inline-flex items-center" href="/" aria-label="Savians Tax Advisors home">
                <Image
                  src="/savians-logo.png"
                  alt="Savians Tax Advisors"
                  width={1996}
                  height={773}
                  priority
                  className="h-10 w-auto sm:h-12"
                />
              </Link>
              <div className="flex items-center gap-3 sm:gap-5">
                <Link
                  className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-lg border border-navy-800 bg-white px-3 py-2 text-sm font-semibold text-navy-800 transition hover:bg-navy-50 sm:px-4"
                  href="/"
                  aria-label="Back to Savians Assessments home"
                >
                  <ArrowLeft aria-hidden size={17} />
                  <span className="hidden sm:inline">Back to Home</span>
                  <span className="sm:hidden">Back</span>
                </Link>
                <span className="hidden text-sm text-slate-500 md:block">
                  Secure Tax Assessment Portal
                </span>
              </div>
            </div>
          </header>
          <main>{children}</main>
          <footer className="border-t border-slate-200 bg-white py-8 text-sm text-slate-500">
            <div className="page-shell flex flex-col justify-between gap-2 sm:flex-row">
              <span>© {new Date().getFullYear()} Savians Tax Advisors</span>
              <span>Confidential and secure client onboarding</span>
            </div>
          </footer>
        </AppProviders>
      </body>
    </html>
  );
}
