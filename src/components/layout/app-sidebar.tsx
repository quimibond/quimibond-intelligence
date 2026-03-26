"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/layout/sidebar-context";
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
  MessagesSquare,
  Search,
  Activity,
  Swords,
  BarChart3,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/companies", label: "Empresas", icon: Building2 },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/threads", label: "Hilos", icon: MessagesSquare },
  { href: "/alerts", label: "Alertas", icon: Bell },
  { href: "/actions", label: "Acciones", icon: CheckSquare },
  { href: "/briefings", label: "Briefings", icon: FileText },
  { href: "/timeline", label: "Timeline", icon: Activity },
  { href: "/competitors", label: "Competidores", icon: Swords },
  { href: "/analytics", label: "Analitica", icon: BarChart3 },
  { href: "/knowledge", label: "Knowledge", icon: Network },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

const bottomItems = [
  { href: "/system", label: "Sistema", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { collapsed, toggle: toggleCollapse } = useSidebar();

  // Close mobile sidebar on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleMobile = useCallback(() => setOpen((v) => !v), []);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={toggleMobile}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground md:hidden"
        aria-label="Toggle menu"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out",
          // Mobile: always w-64, slide in/out
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: always visible, width depends on collapsed state
          collapsed ? "md:w-16 md:translate-x-0" : "md:w-64 md:translate-x-0"
        )}
        // Force w-64 on mobile (override collapsed state)
        style={{ width: undefined }}
      >
        {/* Mobile always gets full width */}
        <div className={cn("flex h-full w-64 flex-col", collapsed && "md:w-16")}>
          {/* Brand */}
          <div className={cn("flex items-center justify-between px-6 py-5", collapsed && "md:justify-center md:px-0")}>
            <Link href="/dashboard" className="flex items-center gap-3">
              <Brain className="h-7 w-7 shrink-0 text-sidebar-primary" />
              <div className={cn(collapsed && "md:hidden")}>
                <div className="text-base font-bold leading-tight">Quimibond</div>
                <div className="text-xs text-muted-foreground">Intelligence</div>
              </div>
            </Link>
            <div className={cn(collapsed && "md:hidden")}>
              <ThemeToggle />
            </div>
          </div>

          {/* Main navigation */}
          <nav className={cn("flex-1 space-y-1 overflow-y-auto px-3", collapsed && "md:px-2")}>
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  collapsed && "md:justify-center md:px-0",
                  isActive(href)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={cn(collapsed && "md:hidden")}>{label}</span>
              </Link>
            ))}

            {/* Separator */}
            <div className="my-3 h-px bg-sidebar-border" />

            {bottomItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  collapsed && "md:justify-center md:px-0",
                  isActive(href)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={cn(collapsed && "md:hidden")}>{label}</span>
              </Link>
            ))}
          </nav>

          {/* Search hint */}
          <div className={cn("px-3 pb-2", collapsed && "md:px-2")}>
            <button
              onClick={() => {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
              }}
              title={collapsed ? "Buscar (⌘K)" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-sidebar-border px-3 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent/50 transition-colors",
                collapsed && "md:justify-center md:px-0 md:border-0"
              )}
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className={cn(collapsed && "md:hidden")}>Buscar...</span>
              <kbd className={cn("ml-auto rounded border border-sidebar-border px-1.5 py-0.5 text-[10px] font-mono", collapsed && "md:hidden")}>
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Collapse toggle (desktop only) */}
          <div className="hidden md:flex items-center justify-center border-t border-sidebar-border py-2">
            <button
              onClick={toggleCollapse}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
              aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
              title={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
            >
              {collapsed ? (
                <ChevronsRight className="h-4 w-4" />
              ) : (
                <ChevronsLeft className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Footer */}
          <div className={cn("border-t border-sidebar-border px-6 py-3", collapsed && "md:px-0 md:text-center")}>
            <span className={cn("text-xs text-muted-foreground", collapsed && "md:hidden")}>v2.0</span>
          </div>
        </div>
      </aside>
    </>
  );
}
