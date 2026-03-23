"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  Brain,
  LayoutDashboard,
  Building2,
  Users,
  Mail,
  Bell,
  CheckSquare,
  FileText,
  Network,
  MessageSquare,
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/companies", label: "Empresas", icon: Building2 },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/alerts", label: "Alertas", icon: Bell },
  { href: "/actions", label: "Acciones", icon: CheckSquare },
  { href: "/briefings", label: "Briefings", icon: FileText },
  { href: "/knowledge", label: "Knowledge", icon: Network },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

const bottomItems = [
  { href: "/system", label: "Sistema", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center justify-between px-6 py-5">
        <Link href="/dashboard" className="flex items-center gap-3">
          <Brain className="h-7 w-7 text-sidebar-primary" />
          <div>
            <div className="text-base font-bold leading-tight">Quimibond</div>
            <div className="text-xs text-muted-foreground">Intelligence</div>
          </div>
        </Link>
        <ThemeToggle />
      </div>

      {/* Main navigation */}
      <nav className="flex-1 space-y-1 px-3">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}

        {/* Separator */}
        <div className="my-3 h-px bg-sidebar-border" />

        {bottomItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-6 py-3">
        <span className="text-xs text-muted-foreground">v1.0</span>
      </div>
    </aside>
  );
}
