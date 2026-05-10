import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
type Ctx = { theme: Theme; setTheme: (t: Theme) => void; resolved: "light" | "dark" };

const ThemeContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "theme-pref-v1";

const apply = (t: Theme): "light" | "dark" => {
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = t === "system" ? (sysDark ? "dark" : "light") : t;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("light", resolved === "light");
  return resolved;
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem(STORAGE_KEY) as Theme) || "system");
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  useEffect(() => { setResolved(apply(theme)); }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => { if (theme === "system") setResolved(apply("system")); };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = (t: Theme) => { localStorage.setItem(STORAGE_KEY, t); setThemeState(t); };

  return <ThemeContext.Provider value={{ theme, setTheme, resolved }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
};
