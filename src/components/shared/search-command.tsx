"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  Bot,
  Building2,
  Factory,
  FileText,
  Home,
  Inbox,
  Lightbulb,
  Loader2,
  Mail,
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

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { cn, timeAgo, truncate } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────
interface SearchResults {
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    company_id: number | null;
    risk_level: string | null;
  }>;
  companies: Array<{
    id: string;
    name: string;
    canonical_name: string | null;
    is_customer: boolean | null;
    is_supplier: boolean | null;
  }>;
  insights: Array<{
    id: string;
    title: string;
    description: string | null;
    severity: string;
    state: string | null;
    created_at: string | null;
    assignee_name: string | null;
  }>;
  emails: Array<{
    id: string;
    subject: string | null;
    snippet: string | null;
    sender: string | null;
    email_date: string | null;
  }>;
}

type SearchItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  detail?: React.ReactNode;
  sublabel?: string;
};

type SearchGroup = {
  label: string;
  icon: LucideIcon;
  items: SearchItem[];
};

// ──────────────────────────────────────────────────────────────────────────
// Navegación rápida — siempre visible cuando no hay query
// ──────────────────────────────────────────────────────────────────────────
const NAV_GROUPS: SearchGroup[] = [
  {
    label: "Atajos del día",
    icon: Sparkles,
    items: [
      { key: "home", href: "/", icon: Home, label: "Home" },
      { key: "inbox", href: "/inbox", icon: Inbox, label: "Inbox (Insights)" },
      { key: "chat", href: "/chat", icon: Sparkles, label: "Chat IA" },
      { key: "briefings", href: "/briefings", icon: FileText, label: "Briefings" },
    ],
  },
  {
    label: "Clientes",
    icon: Building2,
    items: [
      { key: "companies", href: "/companies", icon: Building2, label: "Empresas" },
      { key: "contacts", href: "/contacts", icon: MessageSquare, label: "Contactos" },
    ],
  },
  {
    label: "Financiero",
    icon: Banknote,
    items: [
      { key: "ventas", href: "/ventas", icon: TrendingUp, label: "Ventas" },
      { key: "cobranza", href: "/cobranza", icon: AlertTriangle, label: "Cobranza" },
      { key: "finanzas", href: "/finanzas", icon: Banknote, label: "Finanzas" },
    ],
  },
  {
    label: "Operación",
    icon: Factory,
    items: [
      { key: "compras", href: "/compras", icon: ShoppingBag, label: "Compras" },
      { key: "productos", href: "/productos", icon: Package, label: "Productos" },
      { key: "operaciones", href: "/operaciones", icon: Factory, label: "Operaciones" },
    ],
  },
  {
    label: "Equipo",
    icon: Users,
    items: [
      { key: "equipo", href: "/equipo", icon: Users, label: "Mi equipo" },
      { key: "agents", href: "/agents", icon: Bot, label: "Directores IA" },
    ],
  },
  {
    label: "Admin",
    icon: Settings,
    items: [
      { key: "system", href: "/system", icon: Settings, label: "Sistema" },
      { key: "profile", href: "/profile", icon: UserCircle, label: "Perfil" },
    ],
  },
];

// Flat list para normalizar navegación entre grupos
function flattenGroups(groups: SearchGroup[]): SearchItem[] {
  return groups.flatMap((g) => g.items);
}

// ──────────────────────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────────────────────
export function SearchCommand() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const router = useRouter();

  // ── ⌘K / Ctrl+K para abrir ──────────────────────────────────────────
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Focus input al abrir + reset state al cerrar ─────────────────────
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setResults(null);
      setActiveIndex(0);
    }
  }, [open]);

  // ── Debounced search ──────────────────────────────────────────────────
  const search = React.useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as SearchResults;
        setResults(data);
        setActiveIndex(0);
      }
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
  };

  const navigate = React.useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router]
  );

  // ── Build flat list of current items for keyboard nav ────────────────
  const { groups, flatItems } = React.useMemo(() => {
    if (!results) {
      return {
        groups: NAV_GROUPS,
        flatItems: flattenGroups(NAV_GROUPS),
      };
    }

    const rGroups: SearchGroup[] = [];

    if (results.companies?.length) {
      rGroups.push({
        label: "Empresas",
        icon: Building2,
        items: results.companies.map((c) => ({
          key: `company-${c.id}`,
          href: `/companies/${c.id}`,
          icon: Building2,
          label: c.name,
          detail: (
            <div className="flex gap-1">
              {c.is_customer && (
                <Badge variant="info" className="text-[10px]">
                  Cliente
                </Badge>
              )}
              {c.is_supplier && (
                <Badge variant="secondary" className="text-[10px]">
                  Proveedor
                </Badge>
              )}
            </div>
          ),
        })),
      });
    }

    if (results.contacts?.length) {
      rGroups.push({
        label: "Contactos",
        icon: MessageSquare,
        items: results.contacts.map((c) => ({
          key: `contact-${c.id}`,
          href: `/contacts/${c.id}`,
          icon: MessageSquare,
          label: c.name || c.email || "Sin nombre",
          sublabel: c.email ?? undefined,
          detail: c.risk_level ? (
            <Badge
              variant={
                c.risk_level === "critical"
                  ? "danger"
                  : c.risk_level === "high"
                    ? "warning"
                    : "secondary"
              }
              className="text-[10px] uppercase"
            >
              {c.risk_level}
            </Badge>
          ) : undefined,
        })),
      });
    }

    if (results.insights?.length) {
      rGroups.push({
        label: "Insights",
        icon: Lightbulb,
        items: results.insights.map((a) => ({
          key: `insight-${a.id}`,
          href: `/inbox/insight/${a.id}`,
          icon: Lightbulb,
          label: a.title,
          sublabel: a.assignee_name ?? undefined,
          detail: (
            <div className="flex shrink-0 items-center gap-1.5">
              <SeverityBadge severity={a.severity} />
              {a.created_at && (
                <span className="text-[10px] text-muted-foreground">
                  {timeAgo(a.created_at)}
                </span>
              )}
            </div>
          ),
        })),
      });
    }

    if (results.emails?.length) {
      rGroups.push({
        label: "Emails",
        icon: Mail,
        items: results.emails.map((e) => ({
          key: `email-${e.id}`,
          href: `/inbox?q=${encodeURIComponent(query)}`,
          icon: Mail,
          label: truncate(e.subject ?? "(sin asunto)", 70),
          sublabel: e.sender ?? undefined,
          detail: e.email_date ? (
            <span className="text-[10px] text-muted-foreground">
              {timeAgo(e.email_date)}
            </span>
          ) : undefined,
        })),
      });
    }

    // Always add "Ir a" group with navigation shortcuts matching query
    const q = query.trim().toLowerCase();
    if (q.length >= 2) {
      const matches = flattenGroups(NAV_GROUPS).filter((item) =>
        item.label.toLowerCase().includes(q)
      );
      if (matches.length > 0) {
        rGroups.push({
          label: "Ir a",
          icon: Home,
          items: matches,
        });
      }
    }

    return {
      groups: rGroups,
      flatItems: rGroups.flatMap((g) => g.items),
    };
  }, [results, query]);

  // ── Keyboard: Arrow navigation ────────────────────────────────────────
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatItems[activeIndex];
        if (item) navigate(item.href);
      } else if (e.key === "Home") {
        setActiveIndex(0);
      } else if (e.key === "End") {
        setActiveIndex(flatItems.length - 1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, flatItems, activeIndex, navigate]);

  // ── Scroll active item into view ──────────────────────────────────────
  React.useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`
    );
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // Reset activeIndex when flatItems changes
  React.useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const hasResults = results && flatItems.length > 0;
  const noResults = results && !hasResults && query.trim().length >= 2;

  // Flatten index mapping for group rendering
  let runningIndex = 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Buscar</DialogTitle>

        {/* Input */}
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Buscar empresa, contacto, insight, factura… o escribe un comando"
            className="flex-1 bg-transparent py-4 text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {loading && (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          <kbd className="pointer-events-none hidden select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto p-2"
          role="listbox"
        >
          {noResults ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Search className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No se encontraron resultados para{" "}
                <span className="font-semibold text-foreground">
                  &ldquo;{query}&rdquo;
                </span>
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-2 last:mb-0">
                <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <group.icon className="size-3" />
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const idx = runningIndex++;
                    const isActive = idx === activeIndex;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-index={idx}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => navigate(item.href)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground hover:bg-accent/50"
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            isActive
                              ? "text-accent-foreground"
                              : "text-muted-foreground"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {item.label}
                          </div>
                          {item.sublabel && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {item.sublabel}
                            </div>
                          )}
                        </div>
                        {item.detail && (
                          <div className="shrink-0">{item.detail}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          <KbdHint keys={["↑", "↓"]}>navegar</KbdHint>
          <KbdHint keys={["↵"]}>ir</KbdHint>
          <KbdHint keys={["esc"]}>cerrar</KbdHint>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KbdHint({
  keys,
  children,
}: {
  keys: string[];
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium"
        >
          {k}
        </kbd>
      ))}
      <span>{children}</span>
    </span>
  );
}
