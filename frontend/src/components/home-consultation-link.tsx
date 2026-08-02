"use client";

import { usePathname } from "next/navigation";

export function HomeConsultationLink() {
  const pathname = usePathname();

  if (pathname !== "/") {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1728px] justify-end px-4 pt-2 sm:px-5">
      <a
        className="focus-ring inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-[#ffcc57] px-5 py-2.5 text-sm font-semibold text-[#1a244d] shadow-sm transition hover:bg-[#f2bd3d] focus-visible:outline-[#1a244d] 2xl:text-base"
        href="https://calendly.com/contactus-savians/30min"
        target="_blank"
        rel="noopener noreferrer"
      >
        Schedule a Consultation
      </a>
    </div>
  );
}
