import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeaderAccountAction } from "./site-header-account-action";

const mocks = vi.hoisted(() => ({
  getCurrentPortalAccessToken: vi.fn(),
  getPortalIdentity: vi.fn(),
  replace: vi.fn(),
  signOutFromPortal: vi.fn(),
  usePathname: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: () => ({ replace: mocks.replace })
}));

vi.mock("@/services/portal-auth", () => ({
  getCurrentPortalAccessToken: mocks.getCurrentPortalAccessToken,
  getPortalIdentity: mocks.getPortalIdentity,
  signOutFromPortal: mocks.signOutFromPortal
}));

beforeEach(() => {
  mocks.getCurrentPortalAccessToken.mockReset();
  mocks.getPortalIdentity.mockReset();
  mocks.replace.mockReset();
  mocks.signOutFromPortal.mockReset();
  mocks.usePathname.mockReset();
  mocks.usePathname.mockReturnValue("/");
});

afterEach(cleanup);

describe("SiteHeaderAccountAction", () => {
  it("shows Sign On when no valid portal session exists", async () => {
    mocks.getCurrentPortalAccessToken.mockResolvedValue("");

    render(<SiteHeaderAccountAction />);

    expect(await screen.findByRole("link", { name: "Sign On" })).toHaveAttribute(
      "href",
      "/login"
    );
    expect(screen.getByRole("link", { name: "Sign On" })).toHaveClass(
      "h-11",
      "gap-2",
      "bg-[#1a244d]",
      "font-normal",
      "min-[1500px]:w-[7.25rem]",
      "min-[1500px]:px-0",
      "min-[1600px]:text-base"
    );
    expect(screen.getByRole("link", { name: "Sign On" }).querySelector("svg")).toHaveAttribute(
      "width",
      "16"
    );
  });

  it.each(["ADMIN", "SUPER_ADMIN", "ASSESSMENT_CLIENT"])(
    "shows Log Out for an authenticated %s session",
    async (role) => {
      mocks.getCurrentPortalAccessToken.mockResolvedValue("portal-token");
      mocks.getPortalIdentity.mockReturnValue({
        email: "user@example.com",
        groups: [],
        role,
        sub: "1"
      });

      render(<SiteHeaderAccountAction />);

      const logout = await screen.findByRole("button", { name: "Log Out" });
      expect(logout).toBeInTheDocument();
      expect(logout).toHaveClass(
        "h-11",
        "bg-[#1a244d]",
        "font-normal",
        "min-[1500px]:w-[7.25rem]",
        "min-[1500px]:px-0",
        "min-[1600px]:text-base"
      );
      expect(logout.querySelector("svg")).toHaveAttribute("width", "16");
      expect(screen.queryByRole("link", { name: "Sign On" })).not.toBeInTheDocument();
    }
  );

  it("signs out and returns to the assessment home page", async () => {
    mocks.getCurrentPortalAccessToken.mockResolvedValue("portal-token");
    mocks.getPortalIdentity.mockReturnValue({
      email: "admin@example.com",
      groups: ["ADMIN"],
      role: "ADMIN",
      sub: "1"
    });
    render(<SiteHeaderAccountAction />);

    fireEvent.click(await screen.findByRole("button", { name: "Log Out" }));

    expect(mocks.signOutFromPortal).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/");
    expect(screen.getByRole("link", { name: "Sign On" })).toHaveAttribute("href", "/login");
  });

  it("rechecks the session after login navigation without remounting the header", async () => {
    mocks.getCurrentPortalAccessToken.mockResolvedValueOnce("");
    const { rerender } = render(<SiteHeaderAccountAction />);
    expect(await screen.findByRole("link", { name: "Sign On" })).toBeInTheDocument();

    mocks.usePathname.mockReturnValue("/admin/dashboard");
    mocks.getCurrentPortalAccessToken.mockResolvedValueOnce("admin-token");
    mocks.getPortalIdentity.mockReturnValue({
      email: "admin@example.com",
      groups: ["ADMIN"],
      role: "ADMIN",
      sub: "1"
    });
    rerender(<SiteHeaderAccountAction />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument()
    );
  });

  it("does not expose Log Out for a session without a portal role", async () => {
    mocks.getCurrentPortalAccessToken.mockResolvedValue("portal-token");
    mocks.getPortalIdentity.mockReturnValue({
      email: "user@example.com",
      groups: [],
      role: "UNKNOWN",
      sub: "1"
    });

    render(<SiteHeaderAccountAction />);

    expect(await screen.findByRole("link", { name: "Sign On" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log Out" })).not.toBeInTheDocument();
  });
});
