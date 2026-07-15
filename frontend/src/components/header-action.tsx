"use client";

import Link from "next/link";
import { ArrowLeft, LogIn } from "lucide-react";
import { usePathname } from "next/navigation";

export function HeaderAction() {
  const pathname = usePathname();
  const isHomePage = pathname === "/";

  return (
    <Link
      className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-lg border border-navy-800 bg-white px-3 py-2 text-sm font-semibold text-navy-800 transition hover:bg-navy-50 sm:px-4"
      href={isHomePage ? "/assessment/recover" : "/"}
      aria-label={isHomePage ? "Login or resume assessment" : "Back to Savians Assessments home"}
    >
      {isHomePage ? <LogIn aria-hidden size={17} /> : <ArrowLeft aria-hidden size={17} />}
      <span>{isHomePage ? "Login / Resume" : "Back to Home"}</span>
    </Link>
  );
}
