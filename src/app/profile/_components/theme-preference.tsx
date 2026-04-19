"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark" | "system";

const OPTIONS: Array<{
  value: Theme;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    value: "light",
    label: "Claro",
    icon: Sun,
    description: "Mejor con mucha luz ambiental",
  },
  {
    value: "dark",
    label: "Oscuro",
    icon: Moon,
    description: "Menos fatiga visual en ambientes oscuros",
  },
  {
    value: "system",
    label: "Sistema",
    icon: Monitor,
    description: "Sigue la preferencia del sistema operativo",
  },
];

function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective =
    theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  document.documentElement.classList.toggle("dark", effective === "dark");
}

export function ThemePreference() {
  const [theme, setTheme] = React.useState<Theme>("system");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const stored = localStorage.getItem("qb-theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    } else {
      setTheme("system");
    }
    setMounted(true);
  }, []);

  // Listen for system preference changes when in system mode
  React.useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const handleChange = (next: Theme) => {
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem("qb-theme");
    } else {
      localStorage.setItem("qb-theme", next);
    }
    applyTheme(next);
  };

  if (!mounted) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <div
            key={o.value}
            className="h-[90px] rounded-xl border border-border bg-card"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Preferencia de tema"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {OPTIONS.map(({ value, label, icon: Icon, description }) => {
        const isActive = theme === value;
        return (
          <Button
            key={value}
            variant="ghost"
            role="radio"
            aria-checked={isActive}
            onClick={() => handleChange(value)}
            className={cn(
              "flex h-auto flex-col items-start gap-2 rounded-xl border p-3 text-left",
              isActive
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-accent/40"
            )}
          >
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-lg",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Icon className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">{label}</div>
              <div className="text-[11px] text-muted-foreground">
                {description}
              </div>
            </div>
          </Button>
        );
      })}
    </div>
  );
}
