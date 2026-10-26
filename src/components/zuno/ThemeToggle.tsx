import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Route prefixes where dark mode is allowed at all. Everywhere else (the
 * public marketing site, auth screens, /share, /help) is light-only —
 * see isDashboardRoute() / ThemeRouteSync in __root.tsx.
 */
export const DASHBOARD_THEME_PREFIXES = ["/app", "/seller", "/admin"];

export function isDashboardRoute(pathname: string): boolean {
  return DASHBOARD_THEME_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function getInitial(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("zuno-theme") as Theme | null;
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialFromDom(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Theme is only ever toggleable inside the dashboard (buyer app, seller,
 * admin). This hook still just reflects/writes the shared `dark` class +
 * `zuno-theme` localStorage key — route enforcement (forcing light outside
 * the dashboard) lives in ThemeRouteSync in __root.tsx.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialFromDom);

  useEffect(() => {
    const initial = getInitial();
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  const toggle = () => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      window.localStorage.setItem("zuno-theme", next);
      return next;
    });
  };

  return { theme, toggle };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-foreground transition-colors hover:bg-surface-2 ${className}`}
    >
      {isDark ? <Sun className="h-4 w-4 text-gold" /> : <Moon className="h-4 w-4 text-gold" />}
    </button>
  );
}
