import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";

const headerSession = vi.hoisted(() => ({
  state: "unauthenticated" as "checking" | "authenticated" | "unauthenticated"
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Switch theme</button>
}));

vi.mock("@/components/site-header-account-action", async () => {
  const React = await import("react");
  const { default: Link } = await import("next/link");
  return {
    SiteHeaderAccountAction: ({
      onSessionStateChange
    }: {
      onSessionStateChange?: (state: typeof headerSession.state) => void;
    }) => {
      React.useEffect(() => {
        onSessionStateChange?.(headerSession.state);
      }, [onSessionStateChange]);

      if (headerSession.state === "authenticated") {
        return <button type="button">Log Out</button>;
      }
      if (headerSession.state === "checking") return <span>Account</span>;
      return <Link href="/login">Sign On</Link>;
    }
  };
});

beforeEach(() => {
  headerSession.state = "unauthenticated";
});

afterEach(cleanup);

describe("SiteHeader", () => {
  it("uses the official Savians logo and main-site navigation when signed out", async () => {
    render(<SiteHeader />);

    const logo = screen.getByRole("img", { name: "Savians Tax Advisors" });
    expect(decodeURIComponent(logo.getAttribute("src") ?? "")).toContain("/savians-logo.png");
    expect(logo.closest("a")).toHaveAttribute("href", "https://savians.com/");
    expect(logo).toHaveClass("rounded-[5px]", "border-[#0f1b4d]/70", "p-px");

    const desktopNavigation = await screen.findByRole("group", {
      name: "Desktop navigation"
    });
    expect(desktopNavigation).toHaveClass("min-[1500px]:flex", "justify-center");
    expect(within(desktopNavigation).getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "https://savians.com/"
    );
    expect(within(desktopNavigation).getByRole("link", { name: "About Us" })).toHaveAttribute(
      "href",
      "https://savians.com/about-us/"
    );
    expect(
      within(desktopNavigation).getByRole("link", { name: "Start Tax Assessment" })
    ).toHaveAttribute("aria-current", "page");
    expect(within(desktopNavigation).getByRole("link", { name: "Services" })).toHaveAttribute(
      "href",
      "https://savians.com/services/"
    );
    expect(within(desktopNavigation).getByRole("link", { name: "Contact" })).toHaveAttribute(
      "href",
      "https://savians.com/contact-us/"
    );

    expect(
      within(desktopNavigation).queryByRole("link", { name: "Blogs" })
    ).not.toBeInTheDocument();
  });

  it("provides the shared portal actions and keeps a compact mobile navigation", async () => {
    render(<SiteHeader />);

    await screen.findByRole("group", { name: "Desktop navigation" });
    expect(screen.getByText("Open navigation menu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign On" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("button", { name: "Switch theme" })).toBeInTheDocument();

    const referralLinks = screen.getAllByRole("link", { name: "Become Our Referral Partner" });
    expect(referralLinks).toHaveLength(2);
    for (const link of referralLinks) {
      expect(link).toHaveAttribute("href", "https://referrals.savians.com/");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveClass(
        "h-11",
        "bg-[#1a244d]",
        "font-normal",
        "text-white",
        "min-[1600px]:px-5",
        "min-[1600px]:text-base"
      );
    }

    expect(screen.queryByRole("link", { name: "Schedule a Consultation" })).not.toBeInTheDocument();

    expect(screen.queryByRole("link", { name: /Back to Home/i })).not.toBeInTheDocument();

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toHaveClass(
      "max-w-[1728px]",
      "bg-[#ffcc57]",
      "min-[1500px]:grid",
      "min-[1500px]:h-[63px]",
      "min-[1500px]:min-h-[63px]",
      "min-[1500px]:w-[90%]",
      "min-[1500px]:max-w-none",
      "min-[1500px]:grid-cols-[auto_minmax(0,1fr)_auto]",
      "min-[1500px]:py-0"
    );
  });

  it("hides every public menu option on desktop and mobile while authenticated", async () => {
    headerSession.state = "authenticated";
    render(<SiteHeader />);

    expect(await screen.findByRole("button", { name: "Log Out" })).toBeInTheDocument();
    const portalTitle = screen.getByLabelText("Savians Tax Assessment Portal");
    expect(portalTitle).toHaveClass(
      "savians-portal-title",
      "absolute",
      "left-1/2",
      "top-1/2",
      "text-center"
    );
    expect(portalTitle).toHaveTextContent("Savians");
    expect(portalTitle).toHaveTextContent("Tax Assessment Portal");
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Desktop navigation" })).not.toBeInTheDocument()
    );

    for (const label of ["Home", "About Us", "Start Tax Assessment", "Services", "Contact"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("does not flash public menu options while the session is being checked", () => {
    headerSession.state = "checking";
    render(<SiteHeader />);

    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.queryByLabelText("Savians Tax Assessment Portal")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Desktop navigation" })).not.toBeInTheDocument();
    for (const label of ["Home", "About Us", "Start Tax Assessment", "Services", "Contact"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });
});
