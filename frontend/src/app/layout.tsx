import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/constants";
import { AppProviders } from "@/providers/app-providers";
import { SiteHeader } from "@/components/site-header";
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
            __html: `(function(){var dark=true;try{var key='savians-assessment-theme';var saved=localStorage.getItem(key);dark=saved?saved==='dark':true;}catch(e){}document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';})();`
          }}
        />
      </head>
      <body>
        <AppProviders>
          <SiteHeader />
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
