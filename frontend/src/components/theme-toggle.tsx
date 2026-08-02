"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "savians-assessment-theme";

type Theme = "light" | "dark";

const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setMounted(true);
  }, []);

  const nextTheme: Theme = theme === "dark" ? "light" : "dark";

  function toggleTheme() {
    applyTheme(nextTheme);
    try {
      window.localStorage?.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The visual switch still works when storage is disabled by the browser.
    }
    setTheme(nextTheme);
  }

  return (
    <button
      type="button"
      className="focus-ring inline-grid size-11 shrink-0 place-items-center rounded-lg border border-[#0f1b4d] bg-[#0f1b4d] text-white transition hover:border-[#26366f] hover:bg-[#26366f] disabled:cursor-wait disabled:opacity-70"
      aria-label={mounted ? `Switch to ${nextTheme} theme` : "Theme preference"}
      title={mounted ? `Switch to ${nextTheme} theme` : "Theme preference"}
      onClick={toggleTheme}
      disabled={!mounted}
    >
      {mounted && theme === "dark" ? <Sun aria-hidden size={16} /> : <Moon aria-hidden size={16} />}
    </button>
  );
}
