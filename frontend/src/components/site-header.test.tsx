import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SiteHeader } from "./site-header";

afterEach(cleanup);

describe("SiteHeader", () => {
  it("uses the official Savians logo and main-site navigation", () => {
    render(<SiteHeader />);

    const logo = screen.getByRole("img", { name: "Savians" });
    expect(logo).toHaveAttribute("src", "https://savians.com/images/logo.svg");
    expect(logo.closest("a")).toHaveAttribute("href", "https://savians.com/");

    const desktopNavigation = screen.getByRole("group", { name: "Desktop navigation" });
    expect(desktopNavigation).toHaveClass("lg:flex");
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

  it("matches the main-site actions and keeps a compact mobile navigation", () => {
    render(<SiteHeader />);

    expect(screen.getByText("Open navigation menu")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Login / Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch theme" })).not.toBeInTheDocument();

    const consultationLinks = screen.getAllByRole("link", { name: "Schedule a Consultation" });
    expect(consultationLinks).toHaveLength(2);
    for (const link of consultationLinks) {
      expect(link).toHaveAttribute("href", "https://calendly.com/contactus-savians/30min");
      expect(link).toHaveAttribute("target", "_blank");
    }

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toHaveClass(
      "max-w-[1728px]",
      "bg-[#ffcc57]"
    );
  });
});
