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

export type SiteHeaderSessionState = "checking" | "authenticated" | "unauthenticated";

type SiteHeaderAccountActionProps = {
  onSessionStateChange?: (state: SiteHeaderSessionState) => void;
};

const accountActionClassName =
  "focus-ring inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#1a244d] bg-[#1a244d] px-3 text-sm font-normal text-white transition hover:border-[#26366f] hover:bg-[#26366f] min-[1500px]:w-[7.25rem] min-[1500px]:px-0 min-[1600px]:text-base";

export function SiteHeaderAccountAction({
  onSessionStateChange
}: SiteHeaderAccountActionProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SiteHeaderSessionState>("checking");

  useEffect(() => {
    let active = true;
    setSessionState("checking");
    onSessionStateChange?.("checking");

    void getCurrentPortalAccessToken()
      .then((token) => {
        if (!active) return;
        if (!token) {
          setSessionState("unauthenticated");
          onSessionStateChange?.("unauthenticated");
          return;
        }

        const { role } = getPortalIdentity(token);
        const nextSessionState =
          role === "ADMIN" || role === "SUPER_ADMIN" || role === "ASSESSMENT_CLIENT"
            ? "authenticated"
            : "unauthenticated";
        setSessionState(nextSessionState);
        onSessionStateChange?.(nextSessionState);
      })
      .catch(() => {
        if (active) {
          setSessionState("unauthenticated");
          onSessionStateChange?.("unauthenticated");
        }
      });

    return () => {
      active = false;
    };
  }, [onSessionStateChange, pathname]);

  function logout() {
    signOutFromPortal();
    setSessionState("unauthenticated");
    onSessionStateChange?.("unauthenticated");
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
