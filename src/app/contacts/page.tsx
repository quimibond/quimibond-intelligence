"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, timeAgo } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";

type Contact = {
  id: string;
  email: string;
  name: string;
  company: string;
  contact_type: "internal" | "external" | "client" | "supplier";
  risk_level: "high" | "medium" | "low";
  sentiment_score: number;
  relationship_score: number;
  total_sent: number;
  total_received: number;
  last_interaction: string;
};

const contactTypeLabels: Record<string, string> = {
  internal: "Interno",
  external: "Externo",
  client: "Cliente",
  supplier: "Proveedor",
};

const riskLevelVariant: Record<string, string> = {
  high: "critical",
  medium: "medium",
  low: "low",
};

const riskLevelLabel: Record<string, string> = {
  high: "Alto Riesgo",
  medium: "Medio",
  low: "Bajo",
};

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState<
    "all" | "high" | "medium" | "low"
  >("all");

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("last_interaction", { ascending: false });

      if (error) throw error;
      setContacts(data as Contact[]);
      setFilteredContacts(data as Contact[]);
    } catch (err) {
      console.error("Error fetching contacts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let result = contacts;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (contact) =>
          contact.name?.toLowerCase().includes(query) ||
          contact.email?.toLowerCase().includes(query) ||
          contact.company?.toLowerCase().includes(query)
      );
    }

    // Filter by risk level
    if (selectedRiskLevel !== "all") {
      result = result.filter((contact) => contact.risk_level === selectedRiskLevel);
    }

    setFilteredContacts(result);
  }, [searchQuery, selectedRiskLevel, contacts]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Contactos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Total: <span className="font-semibold">{contacts.length}</span> contactos
        </p>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, email, empresa..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Risk Level Filters */}
            <div className="flex flex-wrap gap-2">
              {["all", "high", "medium", "low"].map((level) => (
                <Button
                  key={level}
                  variant={selectedRiskLevel === level ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    setSelectedRiskLevel(level as "all" | "high" | "medium" | "low")
                  }
                >
                  {level === "all" ? "Todos" : riskLevelLabel[level]}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contacts List */}
      <div className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Card key={i} className="h-20 bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredContacts.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No se encontraron contactos
            </CardContent>
          </Card>
        ) : (
          filteredContacts.map((contact) => (
            <Card
              key={contact.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push(`/contacts/${contact.id}`)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-foreground truncate">
                        {contact.name}
                      </h3>
                      <Badge variant="outline" className="text-xs whitespace-nowrap">
                        {contactTypeLabels[contact.contact_type]}
                      </Badge>
                      <Badge
                        variant={riskLevelVariant[contact.risk_level] as any}
                        className="text-xs whitespace-nowrap"
                      >
                        {riskLevelLabel[contact.risk_level]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{contact.company}</p>
                    <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                  </div>

                  <div className="flex flex-col items-end gap-2 whitespace-nowrap">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Sentimiento</div>
                      <div className="flex items-center gap-1 mt-1">
                        <div className="w-12 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${Math.max(0, Math.min(100, (contact.sentiment_score + 1) * 50))}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Último: {timeAgo(contact.last_interaction)}
                    </div>
                  </div>

                  <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
