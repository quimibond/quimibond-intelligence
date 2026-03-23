"use client";

import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
  }, [isDark]);

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
      aria-label="Cambiar tema"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
