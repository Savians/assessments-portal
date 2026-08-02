import Image from "next/image";
import Link from "next/link";
import { Menu } from "lucide-react";
import { SiteHeaderAccountAction } from "@/components/site-header-account-action";
import { ThemeToggle } from "@/components/theme-toggle";

const navigationLinks = [
  { label: "Home", href: "https://savians.com/", current: false },
  { label: "About Us", href: "https://savians.com/about-us/", current: false },
  { label: "Start Tax Assessment", href: "/", current: true },
  { label: "Services", href: "https://savians.com/services/", current: false },
  { label: "Contact", href: "https://savians.com/contact-us/", current: false }
] as const;

function NavigationLinks({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={mobile ? "flex flex-col" : "flex items-stretch gap-1"}>
      {navigationLinks.map((link) => (
        <Link
          key={link.label}
          className={[
            "savians-main-link focus-ring flex items-center border-b-[3px] px-2.5 py-2 text-sm font-normal tracking-[0.0625em] text-[#1a244d] transition hover:border-[#1a244d] 2xl:px-4 2xl:text-base",
            link.current ? "border-[#1a244d]" : "border-transparent",
            mobile ? "justify-between rounded-lg hover:bg-white/40" : "whitespace-nowrap"
          ].join(" ")}
          href={link.href}
          aria-current={link.current ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

function ReferralPartnerLink({ mobile = false }: { mobile?: boolean }) {
  return (
    <a
      className={[
        "focus-ring inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[#1a244d] px-4 py-2.5 text-sm font-semibold text-[#1a244d] transition hover:bg-white/40",
        mobile ? "mt-4 w-full" : "hidden whitespace-nowrap xl:inline-flex"
      ].join(" ")}
      href="https://referrals.savians.com/"
      target="_blank"
      rel="noopener noreferrer"
    >
      Become Our Referral Partner
    </a>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white sm:px-4 sm:pt-3">
      <nav
        className="savians-brand-header mx-auto flex min-h-[73px] w-full max-w-[1728px] items-center bg-[#ffcc57] px-4 py-3 text-navy-900 sm:min-h-16 sm:rounded-[20px] sm:px-5 sm:py-2"
        aria-label="Primary navigation"
      >
        <a
          className="focus-ring inline-flex shrink-0 items-center"
          href="https://savians.com/"
          aria-label="Savians home"
        >
          <Image
            src="/savians-logo.png"
            alt="Savians Tax Advisors"
            width={1996}
            height={773}
            priority
            className="h-10 w-auto sm:h-12"
          />
        </a>

        <div
          className="ml-5 hidden min-w-0 flex-1 items-center justify-end gap-4 xl:flex 2xl:gap-8"
          role="group"
          aria-label="Desktop navigation"
        >
          <NavigationLinks />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 xl:ml-4">
          <ThemeToggle />
          <SiteHeaderAccountAction />
          <ReferralPartnerLink />
        </div>

        <details className="group relative ml-2 xl:hidden">
          <summary className="focus-ring inline-grid size-11 cursor-pointer list-none place-items-center rounded-lg border border-[#1a244d]/25 bg-transparent text-[#1a244d] transition hover:bg-white/40 [&::-webkit-details-marker]:hidden">
            <Menu aria-hidden size={22} />
            <span className="sr-only">Open navigation menu</span>
          </summary>
          <div className="savians-mobile-menu absolute right-0 z-50 mt-3 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[#1a244d]/20 bg-[#ffcc57] p-4 text-[#1a244d] shadow-card">
            <NavigationLinks mobile />
            <ReferralPartnerLink mobile />
          </div>
        </details>
      </nav>
    </header>
  );
}
