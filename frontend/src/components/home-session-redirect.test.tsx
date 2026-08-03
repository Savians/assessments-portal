import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeSessionRedirect } from "./home-session-redirect";

const mocks = vi.hoisted(() => ({
  clearStoredPortalAccessToken: vi.fn(),
  getCurrentPortalAccessToken: vi.fn(),
  getPortalIdentity: vi.fn(),
  replace: vi.fn(),
  router: { replace: vi.fn() },
  routeForPortalRole: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router
}));

vi.mock("@/services/portal-auth", () => ({
  clearStoredPortalAccessToken: mocks.clearStoredPortalAccessToken,
  getCurrentPortalAccessToken: mocks.getCurrentPortalAccessToken,
  getPortalIdentity: mocks.getPortalIdentity,
  routeForPortalRole: mocks.routeForPortalRole
}));

beforeEach(() => {
  mocks.clearStoredPortalAccessToken.mockReset();
  mocks.getCurrentPortalAccessToken.mockReset();
  mocks.getPortalIdentity.mockReset();
  mocks.replace.mockReset();
  mocks.router.replace = mocks.replace;
  mocks.routeForPortalRole.mockReset();
});

afterEach(cleanup);

describe("HomeSessionRedirect", () => {
  it.each([
    ["ASSESSMENT_CLIENT", "/portal/dashboard"],
    ["ADMIN", "/admin/dashboard"],
    ["SUPER_ADMIN", "/admin/dashboard"]
  ])("redirects an authenticated %s to %s without showing the landing page", async (role, destination) => {
    mocks.getCurrentPortalAccessToken.mockResolvedValue("portal-token");
    mocks.getPortalIdentity.mockReturnValue({ role });
    mocks.routeForPortalRole.mockReturnValue(destination);

    render(
      <HomeSessionRedirect>
        <h1>Public assessment landing page</h1>
      </HomeSessionRedirect>
    );

    expect(screen.getByLabelText("Checking account session")).toBeInTheDocument();
    expect(screen.queryByText("Public assessment landing page")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(destination));
    expect(screen.queryByText("Public assessment landing page")).not.toBeInTheDocument();
  });

  it("shows the public landing page when there is no current session", async () => {
    mocks.getCurrentPortalAccessToken.mockResolvedValue("");

    render(
      <HomeSessionRedirect>
        <h1>Public assessment landing page</h1>
      </HomeSessionRedirect>
    );

    expect(await screen.findByText("Public assessment landing page")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("shows the public landing page for an authenticated identity without a portal role", async () => {
    mocks.getCurrentPortalAccessToken.mockResolvedValue("portal-token");
    mocks.getPortalIdentity.mockReturnValue({ role: "UNKNOWN" });
    mocks.routeForPortalRole.mockReturnValue("/login");

    render(
      <HomeSessionRedirect>
        <h1>Public assessment landing page</h1>
      </HomeSessionRedirect>
    );

    expect(await screen.findByText("Public assessment landing page")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("clears a malformed token and falls back to the public landing page", async () => {
    mocks.getCurrentPortalAccessToken.mockResolvedValue("malformed-token");
    mocks.getPortalIdentity.mockImplementation(() => {
      throw new Error("Invalid portal token.");
    });

    render(
      <HomeSessionRedirect>
        <h1>Public assessment landing page</h1>
      </HomeSessionRedirect>
    );

    expect(await screen.findByText("Public assessment landing page")).toBeInTheDocument();
    expect(mocks.clearStoredPortalAccessToken).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("falls back safely when restoring the current session fails", async () => {
    mocks.getCurrentPortalAccessToken.mockRejectedValue(new Error("Session lookup failed"));

    render(
      <HomeSessionRedirect>
        <h1>Public assessment landing page</h1>
      </HomeSessionRedirect>
    );

    expect(await screen.findByText("Public assessment landing page")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
