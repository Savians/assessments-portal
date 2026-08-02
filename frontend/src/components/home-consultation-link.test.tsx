import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeConsultationLink } from "./home-consultation-link";

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname
}));

afterEach(() => {
  cleanup();
  mockUsePathname.mockReset();
});

describe("HomeConsultationLink", () => {
  it("shows the consultation action on the assessment home page", () => {
    mockUsePathname.mockReturnValue("/");

    render(<HomeConsultationLink />);

    const link = screen.getByRole("link", { name: "Schedule a Consultation" });
    expect(link).toHaveAttribute("href", "https://calendly.com/contactus-savians/30min");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveClass(
      "bg-[#ffcc57]",
      "text-[#1a244d]",
      "hover:bg-[#f2bd3d]",
      "focus-visible:outline-[#1a244d]"
    );
  });

  it.each(["/login", "/assessment/start", "/portal/dashboard", "/admin"])(
    "hides the consultation action on %s",
    (pathname) => {
      mockUsePathname.mockReturnValue(pathname);

      render(<HomeConsultationLink />);

      expect(
        screen.queryByRole("link", { name: "Schedule a Consultation" })
      ).not.toBeInTheDocument();
    }
  );
});
