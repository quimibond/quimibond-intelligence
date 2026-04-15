"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  Bot,
  Building2,
  Factory,
  FileText,
  Grid3x3,
  Home,
  Inbox,
  MessageSquare,
  Package,
  Settings,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface TabDef {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

// 4 primary tabs + 1 "Más" → sheet con el resto.
//
// Alineados con sidebar desktop. Los 4 primary son los atajos del día que
// el CEO revisa al abrir la app. El resto vive en el sheet "Más" con la
// misma taxonomía del sidebar (Clientes / Financiero / Operación / Equipo /
// Admin).
const primaryTabs: TabDef[] = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/inbox", label: "Insights", icon: Inbox },
  { href: "/chat", label: "Chat IA", icon: Sparkles },
  { href: "/finanzas", label: "Finanzas", icon: Banknote },
];

// Secciones secundarias en el sheet "Más" — mismo taxonomy que sidebar.
const moreGroups: Array<{ label: string; tabs: TabDef[] }> = [
  {
    label: "Atajos",
    tabs: [{ href: "/briefings", label: "Briefings", icon: FileText }],
  },
  {
    label: "Clientes",
    tabs: [
      { href: "/companies", label: "Empresas", icon: Building2 },
      { href: "/contacts", label: "Contactos", icon: MessageSquare },
    ],
  },
  {
    label: "Financiero",
    tabs: [
      { href: "/ventas", label: "Ventas", icon: TrendingUp },
      { href: "/cobranza", label: "Cobranza", icon: AlertTriangle },
    ],
  },
  {
    label: "Operación",
    tabs: [
      { href: "/compras", label: "Compras", icon: ShoppingBag },
      { href: "/productos", label: "Productos", icon: Package },
      { href: "/operaciones", label: "Operaciones", icon: Factory },
    ],
  },
  {
    label: "Equipo",
    tabs: [
      { href: "/equipo", label: "Mi equipo", icon: Users },
      { href: "/agents", label: "Directores IA", icon: Bot },
    ],
  },
  {
    label: "Admin",
    tabs: [
      { href: "/system", label: "Sistema", icon: Settings },
      { href: "/profile", label: "Perfil", icon: UserCircle },
    ],
  },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = React.useState(false);

  // Hide on login
  if (pathname === "/login") return null;

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  };

  const isMorePath =
    !primaryTabs.some((t) => isActive(t.href, t.exact)) && pathname !== "/login";

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border bg-background/95 backdrop-blur-md safe-area-bottom"
      aria-label="Navegación principal"
    >
      <div className="flex items-center justify-around px-1 h-16">
        {primaryTabs.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 py-1.5 min-w-[56px] min-h-[56px] transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("size-5", active && "stroke-[2.5]")} />
              <span
                className={cn(
                  "text-[11px] leading-none",
                  active ? "font-bold" : "font-medium"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Abrir menú de navegación"
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 py-1.5 min-w-[56px] min-h-[56px] transition-colors",
                isMorePath ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Grid3x3
                className={cn("size-5", isMorePath && "stroke-[2.5]")}
              />
              <span
                className={cn(
                  "text-[11px] leading-none",
                  isMorePath ? "font-bold" : "font-medium"
                )}
              >
                Más
              </span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] rounded-t-2xl px-4 pb-safe pt-5"
          >
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="size-4 text-primary" />
                Navegar
              </SheetTitle>
            </SheetHeader>
            <div className="mt-2 space-y-5 overflow-y-auto pb-8">
              {moreGroups.map((group) => (
                <div key={group.label}>
                  <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h3>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {group.tabs.map(({ href, label, icon: Icon }) => {
                      const active = isActive(href);
                      return (
                        <button
                          key={href}
                          type="button"
                          onClick={() => {
                            setSheetOpen(false);
                            router.push(href);
                          }}
                          className={cn(
                            "flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 transition-colors",
                            "min-h-[88px]",
                            active
                              ? "border-primary bg-primary/5 text-primary"
                              : "text-foreground hover:bg-accent/40"
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-5",
                              active && "stroke-[2.5]"
                            )}
                          />
                          <span
                            className={cn(
                              "text-xs leading-tight text-center",
                              active && "font-semibold"
                            )}
                          >
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
