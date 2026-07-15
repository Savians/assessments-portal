import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/constants";
import { AppProviders } from "@/providers/app-providers";
import { HeaderAction } from "@/components/header-action";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: "Secure onboarding for the annual Savians Tax Assessment."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var key='savians-assessment-theme';var saved=localStorage.getItem(key);var dark=saved?saved==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';}catch(e){}})();`
          }}
        />
      </head>
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
                <ThemeToggle />
                <HeaderAction />
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
