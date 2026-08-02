"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getCurrentPortalAccessToken,
  getPortalIdentity,
  signOutFromPortal
} from "@/services/portal-auth";

type SessionState = "checking" | "authenticated" | "unauthenticated";

const accountActionClassName =
  "focus-ring inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[#1a244d] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#14235c] sm:px-4";

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
        Log Out
      </button>
    );
  }

  if (sessionState === "checking") {
    return (
      <span
        aria-label="Checking account session"
        className={`${accountActionClassName} pointer-events-none min-w-[4.75rem] opacity-70`}
      >
        Account
      </span>
    );
  }

  return (
    <Link className={accountActionClassName} href="/login">
      Sign On
    </Link>
  );
}
