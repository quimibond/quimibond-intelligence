"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Home,
  Inbox,
  Building2,
  Banknote,
  Menu,
} from "lucide-react";

// 5 tabs per spec mobile-first: Home, Insights, Companies, Finance, Menu.
const tabs = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/inbox", label: "Insights", icon: Inbox },
  { href: "/companies", label: "Empresas", icon: Building2 },
  { href: "/finanzas", label: "Finanzas", icon: Banknote },
  { href: "/agents", label: "Menú", icon: Menu },
];

export function MobileTabBar() {
  const pathname = usePathname();

  // Hide on login
  if (pathname === "/login") return null;

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border bg-background/95 backdrop-blur-md safe-area-bottom">
      <div className="flex items-center justify-around px-1 h-16">
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 py-1.5 transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
              <span className={cn("text-[11px]", active ? "font-bold" : "font-medium")}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
