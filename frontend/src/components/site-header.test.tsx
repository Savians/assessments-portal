import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Switch theme</button>
}));

afterEach(cleanup);

describe("SiteHeader", () => {
  it("uses the official Savians logo and main-site navigation", () => {
    render(<SiteHeader />);

    const logo = screen.getByRole("img", { name: "Savians Tax Advisors" });
    expect(decodeURIComponent(logo.getAttribute("src") ?? "")).toContain("/savians-logo.png");
    expect(logo.closest("a")).toHaveAttribute("href", "https://savians.com/");

    const desktopNavigation = screen.getByRole("group", { name: "Desktop navigation" });
    expect(desktopNavigation).toHaveClass("xl:flex");
    expect(within(desktopNavigation).getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "https://savians.com/"
    );
    expect(within(desktopNavigation).getByRole("link", { name: "About Us" })).toHaveAttribute(
      "href",
      "https://savians.com/about-us/"
    );
    expect(within(desktopNavigation).getByRole("link", { name: "Start Tax Assessment" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(desktopNavigation).getByRole("link", { name: "Services" })).toHaveAttribute(
      "href",
      "https://savians.com/services/"
    );
    expect(within(desktopNavigation).getByRole("link", { name: "Contact" })).toHaveAttribute(
      "href",
      "https://savians.com/contact-us/"
    );

    expect(within(desktopNavigation).queryByRole("link", { name: "Blogs" })).not.toBeInTheDocument();
  });

  it("provides the shared portal actions and keeps a compact mobile navigation", () => {
    render(<SiteHeader />);

    expect(screen.getByText("Open navigation menu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign On" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("button", { name: "Switch theme" })).toBeInTheDocument();

    const referralLinks = screen.getAllByRole("link", { name: "Become Our Referral Partner" });
    expect(referralLinks).toHaveLength(2);
    for (const link of referralLinks) {
      expect(link).toHaveAttribute("href", "https://referrals.savians.com/");
      expect(link).toHaveAttribute("target", "_blank");
    }

    const consultationLink = screen.getByRole("link", { name: "Schedule a Consultation" });
    expect(consultationLink).toHaveAttribute("href", "https://calendly.com/contactus-savians/30min");
    expect(consultationLink).toHaveAttribute("target", "_blank");
    expect(consultationLink.closest("nav")).toBeNull();
    expect(consultationLink.closest("header")).toBeNull();
    expect(consultationLink).toHaveClass(
      "bg-[#ffcc57]",
      "text-[#1a244d]",
      "hover:bg-[#f2bd3d]",
      "focus-visible:outline-[#1a244d]"
    );

    expect(screen.queryByRole("link", { name: /Back to Home/i })).not.toBeInTheDocument();

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toHaveClass(
      "max-w-[1728px]",
      "bg-[#ffcc57]"
    );
  });
});
