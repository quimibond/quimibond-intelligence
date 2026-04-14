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
  AlertTriangle,
  Banknote,
  Bot,
  Brain,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Factory,
  FileText,
  Home,
  Inbox,
  Package,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/inbox", label: "Insights", icon: Inbox },
  { href: "/briefings", label: "Briefings", icon: FileText },
  {
    href: "/companies",
    label: "Empresas",
    icon: Building2,
    children: [
      { href: "/companies/at-risk", label: "Clientes en riesgo" },
    ],
  },
  {
    href: "/ventas",
    label: "Ventas",
    icon: TrendingUp,
    children: [
      { href: "/ventas/cohorts", label: "Retención cohortes" },
    ],
  },
  { href: "/cobranza", label: "Cobranza", icon: AlertTriangle },
  { href: "/finanzas", label: "Finanzas", icon: Banknote },
  { href: "/productos", label: "Productos", icon: Package },
  {
    href: "/compras",
    label: "Compras",
    icon: ShoppingBag,
    children: [
      { href: "/compras/price-variance", label: "Variancia precios" },
      { href: "/compras/stockouts", label: "Stockouts" },
      { href: "/compras/costos-bom", label: "Costos BOM" },
    ],
  },
  { href: "/operaciones", label: "Operaciones", icon: Factory },
  { href: "/equipo", label: "Equipo", icon: Users },
  { href: "/agents", label: "Directores AI", icon: Bot },
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

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  };

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
            <Link href="/" className="flex items-center gap-3">
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
            {navItems.map((item) => {
              const { href, label, icon: Icon, exact, children } = item as {
                href: string;
                label: string;
                icon: typeof Home;
                exact?: boolean;
                children?: { href: string; label: string }[];
              };
              const badge =
                href === "/inbox" && counts.alerts > 0 ? counts.alerts :
                null;
              const active = isActive(href, exact);
              const parentActive = active || (children?.some((c) => isActive(c.href)) ?? false);
              return (
                <div key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? `${label}${badge ? ` (${badge})` : ""}` : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      collapsed && "md:justify-center md:px-0",
                      parentActive
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
                  {children && children.length > 0 && !collapsed && (
                    <div className="ml-7 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
                      {children.map((c) => {
                        const childActive = pathname === c.href;
                        return (
                          <Link
                            key={c.href}
                            href={c.href}
                            aria-current={childActive ? "page" : undefined}
                            className={cn(
                              "rounded-md px-2 py-1 text-xs transition-colors",
                              childActive
                                ? "bg-sidebar-accent/70 text-sidebar-accent-foreground font-medium"
                                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground"
                            )}
                          >
                            {c.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
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
