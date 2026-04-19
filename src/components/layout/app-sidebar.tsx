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
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Factory,
  FileText,
  Home,
  Inbox,
  MessageSquare,
  Package,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ──────────────────────────────────────────────────────────────────────────
// Sidebar restructurado a 4 grupos colapsables (F1.2):
//   1. Decisión     — home, inbox, briefings, chat
//   2. Operación    — ventas, cobranza, compras, operaciones, equipo, finanzas
//   3. Entidades    — empresas, contactos, productos
//   4. Sistema      — directores, sistema, perfil
// ──────────────────────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Sub-páginas anidadas debajo del parent. */
  children?: { href: string; label: string }[];
  /** Para renderizar un badge numérico al lado del label. */
  badgeKey?: "alerts";
}

interface NavGroup {
  /** Label del grupo. */
  label: string;
  /** Si el grupo es colapsable via header click. */
  collapsible?: boolean;
  /** localStorage key para persistir estado collapsed. */
  storageKey?: string;
  items: NavItem[];
}

const topGroups: NavGroup[] = [
  {
    label: "Decisión",
    collapsible: true,
    storageKey: "sidebar-group-decision",
    items: [
      { href: "/", label: "Home", icon: Home, exact: true },
      { href: "/inbox", label: "Inbox", icon: Inbox, badgeKey: "alerts" },
      { href: "/briefings", label: "Briefings", icon: FileText },
      { href: "/chat", label: "Chat", icon: Sparkles },
    ],
  },
  {
    label: "Operación",
    collapsible: true,
    storageKey: "sidebar-group-operacion",
    items: [
      { href: "/ventas", label: "Ventas", icon: TrendingUp },
      { href: "/cobranza", label: "Cobranza", icon: AlertTriangle },
      {
        href: "/compras",
        label: "Compras",
        icon: ShoppingBag,
        // Costos BOM es legítimamente una página standalone (7 vistas del
        // problema de BOM costs). El resto de sub-páginas de compras se
        // fusionaron como secciones dentro de /compras.
        children: [{ href: "/compras/costos-bom", label: "Costos BOM" }],
      },
      { href: "/operaciones", label: "Operaciones", icon: Factory },
      { href: "/equipo", label: "Equipo", icon: Users },
      { href: "/finanzas", label: "Finanzas", icon: Banknote },
    ],
  },
  {
    label: "Entidades",
    collapsible: true,
    storageKey: "sidebar-group-entidades",
    items: [
      { href: "/companies", label: "Empresas", icon: Building2 },
      { href: "/contacts", label: "Contactos", icon: MessageSquare },
      { href: "/productos", label: "Productos", icon: Package },
    ],
  },
  {
    label: "Sistema",
    collapsible: true,
    storageKey: "sidebar-group-sistema",
    items: [
      { href: "/agents", label: "Directores", icon: Bot },
      { href: "/system", label: "Sistema", icon: Settings },
      { href: "/profile", label: "Perfil", icon: UserCircle },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────

export function AppSidebar() {
  const pathname = usePathname();
  const [, setOpen] = useState(false);
  const { collapsed, toggle: toggleCollapse } = useSidebar();
  const counts = useSidebarCounts();

  // Group collapsible state — keyed by storageKey
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Load group collapsed state from localStorage on mount
  useEffect(() => {
    const loaded: Record<string, boolean> = {};
    for (const g of topGroups) {
      if (g.collapsible && g.storageKey && typeof window !== "undefined") {
        const stored = window.localStorage.getItem(g.storageKey);
        loaded[g.storageKey] = stored === "1";
      }
    }
    setCollapsedGroups(loaded);
  }, []);

  const toggleGroup = useCallback((storageKey: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [storageKey]: !prev[storageKey] };
      try {
        window.localStorage.setItem(storageKey, next[storageKey] ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

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

  const isActive = useCallback(
    (href: string, exact?: boolean) => {
      if (exact) return pathname === href;
      return pathname === href || pathname.startsWith(href + "/");
    },
    [pathname]
  );

  // Hide sidebar on login page
  if (pathname === "/login") return null;

  const getBadge = (item: NavItem): number | null => {
    if (item.badgeKey === "alerts" && counts.alerts > 0) return counts.alerts;
    return null;
  };

  const renderItem = (item: NavItem) => {
    const { href, label, icon: Icon, exact, children } = item;
    const badge = getBadge(item);
    const active = isActive(href, exact);
    const parentActive =
      active || (children?.some((c) => isActive(c.href)) ?? false);

    return (
      <div key={href}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          title={
            collapsed ? `${label}${badge ? ` (${badge})` : ""}` : undefined
          }
          className={cn(
            "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            collapsed && "md:justify-center md:px-0",
            parentActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}
        >
          <div className="relative shrink-0">
            <Icon className="h-4 w-4" />
            {badge != null && collapsed && (
              <span className="absolute -right-1 -top-1 hidden md:flex h-2 w-2 rounded-full bg-danger" />
            )}
          </div>
          <span className={cn("flex-1 truncate", collapsed && "md:hidden")}>
            {label}
          </span>
          {badge != null && (
            <span
              className={cn(
                "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger/15 px-1.5 text-[11px] font-semibold text-danger-foreground",
                collapsed && "md:hidden"
              )}
            >
              {badge}
            </span>
          )}
        </Link>
        {children && children.length > 0 && !collapsed && (
          <div className="ml-7 mb-1 mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
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
                      ? "bg-sidebar-accent/70 font-medium text-sidebar-accent-foreground"
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
  };

  const renderGroup = (group: NavGroup, isFirst: boolean) => {
    // In icon-only mode, ignore group collapsible state — show all items as
    // icons with no group headers (preserve existing icon-only UX).
    if (collapsed) {
      return (
        <div key={group.storageKey ?? group.label} className={cn(!isFirst && "mt-4")}>
          {/* Divider between groups in icon-only mode (skip first) */}
          {!isFirst && (
            <div className="mx-auto mb-2 mt-1 h-px w-6 bg-sidebar-border" />
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map(renderItem)}
          </div>
        </div>
      );
    }

    // Expanded sidebar — support collapsible groups
    const isGroupCollapsed =
      group.collapsible && group.storageKey
        ? collapsedGroups[group.storageKey] === true
        : false;

    return (
      <div key={group.storageKey ?? group.label} className={cn(!isFirst && "mt-4")}>
        {group.collapsible && group.storageKey ? (
          <button
            type="button"
            onClick={() => toggleGroup(group.storageKey!)}
            aria-expanded={!isGroupCollapsed}
            className="mb-1 flex w-full items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors"
          >
            <span>{group.label}</span>
            {isGroupCollapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        ) : (
          <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
            {group.label}
          </div>
        )}
        {!isGroupCollapsed && (
          <div className="flex flex-col gap-0.5">
            {group.items.map(renderItem)}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out",
        // Mobile: hidden (bottom tab bar replaces sidebar)
        "hidden md:flex",
        // Desktop: always visible, width depends on collapsed state
        collapsed ? "md:w-16" : "md:w-64"
      )}
    >
      <div className={cn("flex h-full w-64 flex-col", collapsed && "md:w-16")}>
        {/* Brand */}
        <div
          className={cn(
            "flex items-center justify-between px-6 py-5",
            collapsed && "md:justify-center md:px-0"
          )}
        >
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

        {/* Search hint (⌘K) */}
        <div className={cn("px-3 pb-2", collapsed && "md:px-2")}>
          <Button
            variant="ghost"
            onClick={() => {
              document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true })
              );
            }}
            title={collapsed ? "Buscar (⌘K)" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/20 px-3 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent/50",
              collapsed && "md:justify-center md:border-0 md:bg-transparent md:px-0"
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>Buscar…</span>
            <kbd
              className={cn(
                "ml-auto rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px]",
                collapsed && "md:hidden"
              )}
            >
              ⌘K
            </kbd>
          </Button>
        </div>

        {/* Main navigation — 4 collapsible groups */}
        <nav
          aria-label="Navegación principal"
          className={cn(
            "flex-1 space-y-0 overflow-y-auto px-3 pt-1",
            collapsed && "md:px-2"
          )}
        >
          {topGroups.map((g, i) => renderGroup(g, i === 0))}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <div className="hidden items-center justify-center border-t border-sidebar-border py-2 md:flex">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapse}
            className="h-8 w-8 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
            title={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Pipeline status + version */}
        <div
          className={cn(
            "border-t border-sidebar-border",
            collapsed && "md:px-0 md:text-center"
          )}
        >
          <PipelineStatus collapsed={collapsed} />
          <div className={cn("px-6 pb-3", collapsed && "md:px-0")}>
            <span
              className={cn(
                "text-xs text-muted-foreground",
                collapsed && "md:hidden"
              )}
            >
              v2.0
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
