"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import {
  getCurrentPortalAccessToken,
  getPortalIdentity,
  signOutFromPortal
} from "@/services/portal-auth";

type SessionState = "checking" | "authenticated" | "unauthenticated";

const accountActionClassName =
  "focus-ring inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#1a244d] bg-[#1a244d] px-3 text-sm font-normal text-white transition hover:border-[#26366f] hover:bg-[#26366f] min-[1500px]:w-[7.25rem] min-[1500px]:px-0 min-[1600px]:text-base";

export function SiteHeaderAccountAction() {
  const pathname = usePathname();
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>("checking");

  useEffect(() => {
    let active = true;
    setSessionState("checking");

    void getCurrentPortalAccessToken()
      .then((token) => {
        if (!active) return;
        if (!token) {
          setSessionState("unauthenticated");
          return;
        }

        const { role } = getPortalIdentity(token);
        setSessionState(
          role === "ADMIN" || role === "SUPER_ADMIN" || role === "ASSESSMENT_CLIENT"
            ? "authenticated"
            : "unauthenticated"
        );
      })
      .catch(() => {
        if (active) setSessionState("unauthenticated");
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  function logout() {
    signOutFromPortal();
    setSessionState("unauthenticated");
    router.replace("/");
  }

  if (sessionState === "authenticated") {
    return (
      <button className={accountActionClassName} type="button" onClick={logout}>
        <LogOut aria-hidden className="hidden sm:block" size={16} />
        <span>Log Out</span>
      </button>
    );
  }

  if (sessionState === "checking") {
    return (
      <span
        aria-label="Checking account session"
        className={`${accountActionClassName} pointer-events-none min-w-[4.75rem] opacity-70`}
      >
        <LogIn aria-hidden className="hidden sm:block" size={16} />
        <span>Account</span>
      </span>
    );
  }

  return (
    <Link className={accountActionClassName} href="/login">
      <LogIn aria-hidden className="hidden sm:block" size={16} />
      <span>Sign On</span>
    </Link>
  );
}
