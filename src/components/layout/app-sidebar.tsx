"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/layout/sidebar-context";
import { PipelineStatus } from "@/components/layout/pipeline-status";
import { useSidebarCounts } from "@/components/layout/sidebar-badges";
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
  Inbox,
  Share2,
  Bot,
  UserCheck,
  Layers,
  BookOpen,
} from "lucide-react";

const navItems = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/companies", label: "Empresas", icon: Building2 },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/employees", label: "Equipo", icon: UserCheck },
  { href: "/analytics", label: "Analitica", icon: BarChart3 },
  { href: "/budgets", label: "Presupuestos", icon: BookOpen },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/threads", label: "Hilos", icon: MessagesSquare },
  { href: "/knowledge", label: "Knowledge", icon: Share2 },
  { href: "/briefings", label: "Briefings", icon: FileText },
  { href: "/chat", label: "Chat IA", icon: MessageSquare },
  { href: "/agents", label: "Directores IA", icon: Bot },
];

const bottomItems = [
  { href: "/system", label: "Sistema", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { collapsed, toggle: toggleCollapse } = useSidebar();
  const counts = useSidebarCounts();

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

  // Hide sidebar on login page
  if (pathname === "/login") return null;

  return (
    <>
      {/* Sidebar (desktop only — mobile uses MobileTabBar) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out",
          // Mobile: hidden (bottom tab bar replaces sidebar)
          "hidden md:flex",
          // Desktop: always visible, width depends on collapsed state
          collapsed ? "md:w-16" : "md:w-64"
        )}
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
          <nav aria-label="Navegacion principal" className={cn("flex-1 space-y-1 overflow-y-auto px-3", collapsed && "md:px-2")}>
            {navItems.map(({ href, label, icon: Icon }) => {
              const badge =
                href === "/inbox" && counts.alerts > 0 ? counts.alerts :
                null;
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? `${label}${badge ? ` (${badge})` : ""}` : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    collapsed && "md:justify-center md:px-0",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <div className="relative shrink-0">
                    <Icon className="h-4 w-4" />
                    {badge != null && collapsed && (
                      <span className="absolute -right-1 -top-1 hidden md:flex h-3 w-3 items-center justify-center rounded-full bg-danger text-[8px] font-bold text-destructive-foreground" />
                    )}
                  </div>
                  <span className={cn("flex-1", collapsed && "md:hidden")}>{label}</span>
                  {badge != null && (
                    <span className={cn(
                      "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger/15 px-1.5 text-[11px] font-semibold text-danger-foreground",
                      collapsed && "md:hidden"
                    )}>
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Separator */}
            <div className="my-3 h-px bg-sidebar-border" />

            {bottomItems.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  collapsed && "md:justify-center md:px-0",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={cn(collapsed && "md:hidden")}>{label}</span>
              </Link>
              );
            })}
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

          {/* Pipeline status + Footer */}
          <div className={cn("border-t border-sidebar-border", collapsed && "md:px-0 md:text-center")}>
            <PipelineStatus collapsed={collapsed} />
            <div className={cn("px-6 pb-3", collapsed && "md:px-0")}>
              <span className={cn("text-xs text-muted-foreground", collapsed && "md:hidden")}>v2.0</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
