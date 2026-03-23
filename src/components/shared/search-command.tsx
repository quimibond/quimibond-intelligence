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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { RiskBadge } from "@/components/shared/risk-badge";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { cn, truncate, timeAgo } from "@/lib/utils";

interface SearchResults {
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    company: string | null;
    risk_level: string | null;
  }>;
  entities: Array<{
    id: string;
    name: string;
    canonical_name: string | null;
    entity_type: string | null;
  }>;
  alerts: Array<{
    id: string;
    title: string;
    description: string | null;
    severity: string;
    state: string | null;
    created_at: string | null;
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
    received_at: string | null;
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
    (results.contacts.length > 0 ||
      results.entities.length > 0 ||
      results.alerts.length > 0 ||
      results.facts.length > 0 ||
      results.emails.length > 0);

  const noResults = results && !hasResults && query.trim().length >= 2;

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
              placeholder="Buscar contactos, empresas, alertas, emails..."
              className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Results */}
          <ScrollArea className="max-h-[420px]">
            <div className="p-2">
              {/* Empty state */}
              {!results && !loading && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Search className="mb-3 size-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    Escribe para buscar en todo el sistema
                  </p>
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

              {/* Contactos */}
              {results && results.contacts.length > 0 && (
                <ResultGroup label="Contactos" icon={Users}>
                  {results.contacts.map((c) => (
                    <ResultItem
                      key={c.id}
                      onClick={() => navigate(`/contacts/${c.id}`)}
                    >
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <span className="truncate font-medium">{c.name}</span>
                        {c.company && (
                          <span className="truncate text-muted-foreground">
                            {c.company}
                          </span>
                        )}
                      </div>
                      {c.risk_level && <RiskBadge level={c.risk_level} />}
                    </ResultItem>
                  ))}
                </ResultGroup>
              )}

              {/* Empresas (entities of type company/organization) */}
              {results && results.entities.length > 0 && (
                <ResultGroup label="Empresas" icon={Building2}>
                  {results.entities.map((e) => (
                    <ResultItem
                      key={e.id}
                      onClick={() => navigate(`/companies/${e.id}`)}
                    >
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <span className="truncate font-medium">
                          {e.canonical_name || e.name}
                        </span>
                        {e.entity_type && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {e.entity_type}
                          </Badge>
                        )}
                      </div>
                    </ResultItem>
                  ))}
                </ResultGroup>
              )}

              {/* Alertas */}
              {results && results.alerts.length > 0 && (
                <ResultGroup label="Alertas" icon={Bell}>
                  {results.alerts.map((a) => (
                    <ResultItem
                      key={a.id}
                      onClick={() => navigate("/alerts")}
                    >
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <SeverityBadge severity={a.severity} />
                        <span className="truncate">{a.title}</span>
                      </div>
                      {a.state && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {a.state}
                        </Badge>
                      )}
                    </ResultItem>
                  ))}
                </ResultGroup>
              )}

              {/* Hechos */}
              {results && results.facts.length > 0 && (
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
              {results && results.emails.length > 0 && (
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
                      {e.received_at && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(e.received_at)}
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
