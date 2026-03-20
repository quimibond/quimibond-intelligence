"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Search, ChevronRight } from "lucide-react";
import Link from "next/link";

interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  risk_level: string;
  sentiment_score: number;
  last_interaction: string;
  total_emails: number;
  tags: string[];
}

const riskVariant: Record<string, "destructive" | "warning" | "success" | "info"> = {
  high: "destructive",
  medium: "warning",
  low: "success",
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("contacts")
        .select("*")
        .order("last_interaction", { ascending: false })
        .limit(100);
      setContacts(data || []);
      setLoading(false);
    }
    fetch();
  }, []);

  const filtered = search
    ? contacts.filter(
        (c) =>
          c.name?.toLowerCase().includes(search.toLowerCase()) ||
          c.email?.toLowerCase().includes(search.toLowerCase()) ||
          c.company?.toLowerCase().includes(search.toLowerCase())
      )
    : contacts;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contactos</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {contacts.length} contactos en el sistema
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          type="text"
          placeholder="Buscar por nombre, email o empresa..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-pulse text-[var(--muted-foreground)]">Cargando contactos...</div>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="mb-3 h-10 w-10 text-[var(--muted-foreground)] opacity-50" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {search ? "No se encontraron contactos." : "No hay contactos aun."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Riesgo</th>
                <th className="px-4 py-3">Sentimiento</th>
                <th className="px-4 py-3">Emails</th>
                <th className="px-4 py-3">Ultima interaccion</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr key={contact.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--accent)]/50">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{contact.name || "—"}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">{contact.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{contact.company || "—"}</td>
                  <td className="px-4 py-3">
                    {contact.risk_level && (
                      <Badge variant={riskVariant[contact.risk_level] || "info"}>
                        {contact.risk_level}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {contact.sentiment_score != null ? (
                      <span
                        className={
                          contact.sentiment_score >= 0.5
                            ? "text-emerald-400"
                            : contact.sentiment_score <= -0.2
                              ? "text-red-400"
                              : "text-[var(--muted-foreground)]"
                        }
                      >
                        {contact.sentiment_score.toFixed(2)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{contact.total_emails ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                    {contact.last_interaction
                      ? new Date(contact.last_interaction).toLocaleDateString("es-MX", { day: "numeric", month: "short" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/contacts/${contact.id}`}>
                      <Button variant="ghost" size="icon">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
