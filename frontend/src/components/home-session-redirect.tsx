"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearStoredPortalAccessToken,
  getCurrentPortalAccessToken,
  getPortalIdentity,
  routeForPortalRole
} from "@/services/portal-auth";

export function HomeSessionRedirect({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;

    void getCurrentPortalAccessToken()
      .then((token) => {
        if (!active) return;
        if (!token) {
          setIsCheckingSession(false);
          return;
        }

        try {
          const destination = routeForPortalRole(getPortalIdentity(token).role);
          if (destination === "/portal/dashboard" || destination === "/admin/dashboard") {
            router.replace(destination);
            return;
          }

          setIsCheckingSession(false);
        } catch {
          clearStoredPortalAccessToken();
          setIsCheckingSession(false);
        }
      })
      .catch(() => {
        if (active) setIsCheckingSession(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  if (isCheckingSession) {
    return (
      <section
        aria-label="Checking account session"
        className="grid min-h-[70vh] place-items-center bg-navy-900 text-slate-200"
      >
        <p className="text-sm">Opening your secure assessment...</p>
      </section>
    );
  }

  return children;
}
