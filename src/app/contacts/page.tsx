"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
import {
  Search,
  ChevronRight,
  Users,
  AlertTriangle,
  Activity,
} from "lucide-react";
import Link from "next/link";

interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  contact_type: string;
  risk_level: string;
  sentiment_score: number;
  relationship_score: number;
  last_activity: string;
  total_sent: number;
  total_received: number;
  tags: string[];
}

const riskToBadge: Record<string, "critical" | "high" | "medium" | "low" | "success"> = {
  high: "critical",
  medium: "medium",
  low: "success",
};

function getHealthScore(sentiment: number, relationship: number): number {
  const s = sentiment ?? 0;
  const r = relationship ?? 50;
  return Math.max(0, Math.min(100, Math.round(((s + 1) / 2) * 50 + (r / 100) * 50)));
}

function getHealthLevel(score: number): "high" | "mid" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
  return "low";
}

function getHealthLabel(score: number): string {
  if (score >= 70) return "FUERTE";
  if (score >= 40) return "ESTABLE";
  return "CRITICO";
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");

  useEffect(() => {
    async function fetchContacts() {
      const { data } = await supabase
        .from("contacts")
        .select("*")
        .order("last_activity", { ascending: false })
        .limit(100);
      setContacts(data || []);
      setLoading(false);
    }
    fetchContacts();
  }, []);

  const filtered = contacts.filter((c) => {
    const matchesSearch = !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase()) ||
      c.company?.toLowerCase().includes(search.toLowerCase());
    const matchesRisk = riskFilter === "all" || c.risk_level === riskFilter;
    return matchesSearch && matchesRisk;
  });

  const highRisk = contacts.filter(c => c.risk_level === "high").length;
  const medRisk = contacts.filter(c => c.risk_level === "medium").length;

  const riskFilters = [
    { key: "all", label: "Todos", count: contacts.length },
    { key: "high", label: "Alto Riesgo", count: highRisk },
    { key: "medium", label: "Medio", count: medRisk },
    { key: "low", label: "Bajo", count: contacts.length - highRisk - medRisk },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-[var(--success)]" />
            <h1 className="text-2xl font-black tracking-tight">Roster de Contactos</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {contacts.length} agentes en el sistema
          </p>
        </div>
        {highRisk > 0 && (
          <div className="hidden md:flex items-center gap-2 text-xs text-[var(--destructive)]">
            <AlertTriangle className="h-4 w-4" />
            {highRisk} en riesgo alto
          </div>
        )}
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Buscar por nombre, email o empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <div className="flex items-center gap-1">
          {riskFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setRiskFilter(f.key)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                riskFilter === f.key
                  ? "bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Activity className="h-6 w-6 text-[var(--primary)] animate-pulse" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-10 w-10 mb-3 text-[var(--muted-foreground)] opacity-30" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {search ? "No se encontraron contactos." : "No hay contactos aun."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((contact) => {
            const health = getHealthScore(contact.sentiment_score, contact.relationship_score);
            const level = getHealthLevel(health);
            const label = getHealthLabel(health);
            const riskVar = contact.risk_level === "high" ? "var(--risk-high)"
              : contact.risk_level === "medium" ? "var(--risk-medium)" : "var(--risk-low)";
            const riskMutedVar = contact.risk_level === "high" ? "var(--risk-high-muted)"
              : contact.risk_level === "medium" ? "var(--risk-medium-muted)" : "var(--risk-low-muted)";

            return (
              <Link key={contact.id} href={`/contacts/${contact.id}`}>
                <Card className={cn(
                  "cursor-pointer transition-all hover:border-[var(--primary)]",
                  contact.risk_level === "high" && "border-l-3 border-l-[var(--risk-high)]",
                )}>
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* Avatar */}
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                      style={{ backgroundColor: riskMutedVar, color: riskVar }}
                    >
                      {(contact.name || contact.email).charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">
                          {contact.name || contact.email}
                        </span>
                        {contact.contact_type && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 hidden sm:inline-flex">{contact.contact_type}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)] mt-0.5">
                        <span className="truncate">{contact.company || contact.email}</span>
                        <span className="hidden md:inline">{(contact.total_sent || 0) + (contact.total_received || 0)} emails</span>
                        {contact.last_activity && (
                          <span className="hidden lg:inline">{timeAgo(contact.last_activity)}</span>
                        )}
                      </div>
                    </div>

                    {/* Health Bar */}
                    <div className="hidden sm:flex items-center gap-3 shrink-0 w-36">
                      <div className="flex-1">
                        <div className="health-bar-track">
                          <div
                            className="health-bar-fill"
                            data-level={level}
                            style={{ width: `${health}%` }}
                          />
                        </div>
                      </div>
                      <span
                        className="text-[10px] font-bold uppercase w-16 text-right"
                        style={{ color: `var(--health-${level})` }}
                      >
                        {label} {health}%
                      </span>
                    </div>

                    {/* Risk Badge */}
                    <div className="hidden md:block shrink-0">
                      <Badge variant={riskToBadge[contact.risk_level] || "success"}>
                        {contact.risk_level || "low"}
                      </Badge>
                    </div>

                    <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
