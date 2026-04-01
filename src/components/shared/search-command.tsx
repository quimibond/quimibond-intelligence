"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  Building2,
  Bell,
  Lightbulb,
  Mail,
  Loader2,
  LayoutDashboard,
  FileText,
  MessageSquare,
  Settings,
  Activity,
  Bot,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RiskBadge } from "@/components/shared/risk-badge";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { cn, truncate, timeAgo } from "@/lib/utils";

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
  facts: Array<{
    id: string;
    fact_text: string;
    confidence: number | null;
    entity_id: string | null;
    created_at: string | null;
  }>;
  emails: Array<{
    id: string;
    subject: string | null;
    snippet: string | null;
    sender: string | null;
    email_date: string | null;
  }>;
}

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();

  // Ctrl+K / Cmd+K to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setResults(null);
    }
  }, [open]);

  const search = useCallback(async (q: string) => {
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
        const data = await res.json();
        setResults(data);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInputChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  }

  function navigate(path: string) {
    setOpen(false);
    router.push(path);
  }

  const hasResults =
    results &&
    ((results.contacts?.length ?? 0) > 0 ||
      (results.companies?.length ?? 0) > 0 ||
      (results.insights?.length ?? 0) > 0 ||
      (results.facts?.length ?? 0) > 0 ||
      (results.emails?.length ?? 0) > 0);

  const noResults = results && !hasResults && query.trim().length >= 2;

  const quickActions = [
    { label: "Inbox", icon: Bell, href: "/inbox" },
    { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
    { label: "Agentes IA", icon: Bot, href: "/agents" },
    { label: "Ultimo briefing", icon: FileText, href: "/briefings" },
    { label: "Chat con IA", icon: MessageSquare, href: "/chat" },
    { label: "Empresas", icon: Building2, href: "/companies" },
    { label: "Knowledge", icon: Search, href: "/knowledge" },
    { label: "Sistema", icon: Settings, href: "/system" },
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Buscar...</span>
        <kbd className="pointer-events-none hidden select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden">
          <DialogTitle className="sr-only">Buscar</DialogTitle>

          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="Buscar empresas, contactos, insights, emails..."
              className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Results */}
          <ScrollArea className="max-h-[420px]">
            <div className="p-2">
              {/* Quick actions (when no query) */}
              {!results && !loading && (
                <div>
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <Activity className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones rapidas
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {quickActions.map((action) => (
                      <ResultItem
                        key={action.href}
                        onClick={() => navigate(action.href)}
                      >
                        <action.icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm">{action.label}</span>
                      </ResultItem>
                    ))}
                  </div>
                </div>
              )}

              {/* No results */}
              {noResults && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    No se encontraron resultados para &quot;{query}&quot;
                  </p>
                </div>
              )}

              {/* Empresas */}
              {results && (results.companies?.length ?? 0) > 0 && (
                <ResultGroup label="Empresas" icon={Building2}>
                  {results.companies.map((c) => (
                    <ResultItem
                      key={c.id}
                      onClick={() => navigate(`/companies/${c.id}`)}
                    >
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <span className="truncate font-medium">{c.name}</span>
                        <div className="flex gap-1">
                          {c.is_customer && <Badge variant="outline" className="text-[10px]">Cliente</Badge>}
                          {c.is_supplier && <Badge variant="outline" className="text-[10px]">Proveedor</Badge>}
                        </div>
                      </div>
                    </ResultItem>
                  ))}
                </ResultGroup>
              )}

              {/* Contactos */}
              {results && (results.contacts?.length ?? 0) > 0 && (
                <ResultGroup label="Contactos" icon={Users}>
                  {results.contacts.map((c) => (
                    <ResultItem
                      key={c.id}
                      onClick={() => navigate(`/contacts/${c.id}`)}
                    >
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <span className="truncate font-medium">{c.name}</span>
                        {c.email && (
                          <span className="truncate text-xs text-muted-foreground">
                            {c.email}
                          </span>
                        )}
                      </div>
                      {c.risk_level && <RiskBadge level={c.risk_level} />}
                    </ResultItem>
                  ))}
                </ResultGroup>
              )}

              {/* Insights */}
              {results && (results.insights?.length ?? 0) > 0 && (
                <ResultGroup label="Insights" icon={Lightbulb}>
                  {results.insights.map((a) => (
                    <ResultItem
                      key={a.id}
                      onClick={() => navigate(`/inbox/insight/${a.id}`)}
                    >
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <SeverityBadge severity={a.severity} />
                        <span className="truncate">{a.title}</span>
                      </div>
                      {a.created_at && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(a.created_at)}
                        </span>
                      )}
                    </ResultItem>
                  ))}
                </ResultGroup>
              )}

              {/* Hechos */}
              {results && (results.facts?.length ?? 0) > 0 && (
                <ResultGroup label="Hechos" icon={Lightbulb}>
                  {results.facts.map((f) => (
                    <ResultItem key={f.id}>
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <span className="truncate text-sm">
                          {truncate(f.fact_text, 80)}
                        </span>
                      </div>
                      {f.confidence != null && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {Math.round(f.confidence * 100)}%
                        </span>
                      )}
                    </ResultItem>
                  ))}
                </ResultGroup>
              )}

              {/* Emails */}
              {results && (results.emails?.length ?? 0) > 0 && (
                <ResultGroup label="Emails" icon={Mail}>
                  {results.emails.map((e) => (
                    <ResultItem
                      key={e.id}
                      onClick={() => navigate(`/emails/${e.id}`)}
                    >
                      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                        <span className="truncate text-sm font-medium">
                          {e.subject || "(sin asunto)"}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {e.sender}
                        </span>
                      </div>
                      {e.email_date && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(e.email_date)}
                        </span>
                      )}
                    </ResultItem>
                  ))}
                </ResultGroup>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResultGroup({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ResultItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
        "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
        onClick ? "cursor-pointer" : "cursor-default"
      )}
    >
      {children}
    </button>
  );
}
