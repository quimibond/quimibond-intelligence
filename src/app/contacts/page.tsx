"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, getInitials, timeAgo } from "@/lib/utils";
import type { Contact } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { RiskBadge } from "@/components/shared/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function sentimentColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 0.6) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.3) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

const PAGE_SIZE = 50;

function buildQuery(search: string, riskFilter: string) {
  let q = supabase
    .from("contacts")
    .select("*, companies(name)")
    .order("name", { ascending: true });

  if (riskFilter !== "all") {
    q = q.eq("risk_level", riskFilter);
  }
  if (search.trim()) {
    const pattern = `%${search.trim()}%`;
    q = q.or(`name.ilike.${pattern},email.ilike.${pattern}`);
  }
  return q;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchContacts = useCallback(async (searchVal: string, risk: string) => {
    setLoading(true);
    const { data } = await buildQuery(searchVal, risk).limit(PAGE_SIZE);
    setContacts(data ?? []);
    setHasMore((data ?? []).length === PAGE_SIZE);
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    fetchContacts("", "all");
  }, [fetchContacts]);

  // Debounced search + filter
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchContacts(search, riskFilter);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, riskFilter, fetchContacts]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await buildQuery(search, riskFilter)
      .range(contacts.length, contacts.length + PAGE_SIZE - 1);
    if (data) {
      setContacts((prev) => [...prev, ...(data as Contact[])]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  return (
    <div>
      <PageHeader
        title="Contactos"
        description="Directorio de contactos con inteligencia relacional"
      />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pb-4">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o email..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="w-full sm:w-36"
        >
          <option value="all">Todos</option>
          <option value="low">Bajo</option>
          <option value="medium">Medio</option>
          <option value="high">Alto</option>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sin contactos"
          description="No se encontraron contactos con los filtros actuales."
        />
      ) : (
        <>
        {/* Mobile card layout */}
        <div className="space-y-3 md:hidden">
          {contacts.map((contact) => (
            <div key={contact.id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <Link href={`/contacts/${contact.id}`} className="text-sm font-medium hover:underline">
                    {contact.name ?? "—"}
                  </Link>
                  {contact.email && (
                    <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {contact.company_id && (
                  <Link href={`/companies/${contact.company_id}`} className="hover:underline hover:text-foreground">
                    {((contact as unknown as Record<string, unknown>).companies as { name: string } | null)?.name ?? `Empresa #${contact.company_id}`}
                  </Link>
                )}
                {contact.role && <><span className="text-border">·</span><span>{contact.role}</span></>}
                {contact.contact_type && <><span className="text-border">·</span><span>{contact.contact_type === "internal" ? "Interno" : "Externo"}</span></>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <RiskBadge level={contact.risk_level} />
                <span
                  className={cn(
                    "tabular-nums font-medium",
                    sentimentColor(contact.sentiment_score)
                  )}
                >
                  Sent: {contact.sentiment_score != null
                    ? contact.sentiment_score.toFixed(2)
                    : "—"}
                </span>
                <span className="text-muted-foreground">
                  Emails: {(contact.total_sent ?? 0) + (contact.total_received ?? 0)}
                </span>
                <span className="text-muted-foreground">
                  {timeAgo(contact.last_activity)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table layout */}
        <div className="hidden md:block">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Nombre</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Riesgo</TableHead>
                <TableHead className="text-right">Sentimiento</TableHead>
                <TableHead className="text-right">Emails</TableHead>
                <TableHead>Ultima actividad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/contacts/${contact.id}`} className="contents">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">
                          {getInitials(contact.name)}
                        </AvatarFallback>
                      </Avatar>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="font-medium hover:underline"
                    >
                      {contact.name ?? "—"}
                    </Link>
                    {contact.email && (
                      <p className="text-xs text-muted-foreground">
                        {contact.email}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contact.company_id ? (
                      <Link href={`/companies/${contact.company_id}`} className="hover:underline hover:text-foreground">
                        {((contact as unknown as Record<string, unknown>).companies as { name: string } | null)?.name ?? `Empresa #${contact.company_id}`}
                      </Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contact.role ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contact.contact_type ?? "—"}
                  </TableCell>
                  <TableCell>
                    <RiskBadge level={contact.risk_level} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        "tabular-nums font-medium",
                        sentimentColor(contact.sentiment_score)
                      )}
                    >
                      {contact.sentiment_score != null
                        ? contact.sentiment_score.toFixed(2)
                        : "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(contact.total_sent ?? 0) + (contact.total_received ?? 0)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {timeAgo(contact.last_activity)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </div>
        </>
      )}

      {hasMore && contacts.length > 0 && !search && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loadingMore ? "Cargando..." : "Cargar mas"}
          </Button>
        </div>
      )}
    </div>
  );
}
