import Image from "next/image";
import Link from "next/link";
import { Menu } from "lucide-react";

const SAVIANS_LOGO_URL = "https://savians.com/images/logo.svg";

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

function ConsultationLink({ mobile = false }: { mobile?: boolean }) {
  return (
    <a
      className={[
        "focus-ring inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[#1a244d] px-5 py-2.5 text-sm font-normal text-white transition hover:bg-[#14235c] 2xl:text-base",
        mobile ? "mt-4 w-full" : "whitespace-nowrap"
      ].join(" ")}
      href="https://calendly.com/contactus-savians/30min"
      target="_blank"
      rel="noopener noreferrer"
    >
      Schedule a Consultation
    </a>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white py-0 sm:px-4 sm:py-3">
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
            src={SAVIANS_LOGO_URL}
            alt="Savians"
            width={182}
            height={47}
            priority
            unoptimized
            className="savians-brand-logo h-auto"
          />
        </a>

        <div
          className="ml-5 hidden min-w-0 flex-1 items-center justify-end gap-4 lg:flex 2xl:gap-8"
          role="group"
          aria-label="Desktop navigation"
        >
          <NavigationLinks />
          <ConsultationLink />
        </div>

        <details className="group relative ml-auto lg:hidden">
          <summary className="focus-ring inline-grid size-11 cursor-pointer list-none place-items-center rounded-lg border border-[#1a244d]/25 bg-transparent text-[#1a244d] transition hover:bg-white/40 [&::-webkit-details-marker]:hidden">
            <Menu aria-hidden size={22} />
            <span className="sr-only">Open navigation menu</span>
          </summary>
          <div className="savians-mobile-menu absolute right-0 z-50 mt-3 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[#1a244d]/20 bg-[#ffcc57] p-4 text-[#1a244d] shadow-card">
            <NavigationLinks mobile />
            <ConsultationLink mobile />
          </div>
        </details>
      </nav>
    </header>
  );
}
