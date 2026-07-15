import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, ThemeToggle } from "./theme-toggle";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("ThemeToggle", () => {
  it("switches the root theme and persists the preference", async () => {
    const setItem = vi.fn();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { setItem }
    });
    render(<ThemeToggle />);
    const toggle = await screen.findByRole("button", { name: "Switch to dark theme" });

    fireEvent.click(toggle);

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
    await waitFor(() => expect(toggle).toHaveAccessibleName("Switch to light theme"));
  });
});
