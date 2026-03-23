"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import type { Entity } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Search, Users, ArrowRight } from "lucide-react";

interface CompanyWithCount extends Entity {
  contact_count: number;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      // Fetch company entities
      const { data: entities, error } = await supabase
        .from("entities")
        .select("*")
        .eq("entity_type", "company")
        .order("name");

      if (error || !entities) {
        setLoading(false);
        return;
      }

      // Fetch contact counts grouped by company
      const { data: contacts } = await supabase
        .from("contacts")
        .select("company");

      const countMap = new Map<string, number>();
      if (contacts) {
        for (const c of contacts) {
          if (c.company) {
            const key = c.company.toLowerCase();
            countMap.set(key, (countMap.get(key) ?? 0) + 1);
          }
        }
      }

      const companiesWithCounts: CompanyWithCount[] = (entities as Entity[]).map(
        (entity) => ({
          ...entity,
          contact_count:
            countMap.get(entity.name.toLowerCase()) ??
            countMap.get((entity.canonical_name ?? "").toLowerCase()) ??
            0,
        })
      );

      setCompanies(companiesWithCounts);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas"
        description="Directorio de empresas e inteligencia comercial"
      />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar empresa..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[160px] w-full" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={Building2}
          title="Sin empresas"
          description={
            search
              ? "No se encontraron empresas con ese nombre."
              : "Aun no hay empresas registradas en el sistema."
          }
        />
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((company) => {
            const industry = company.attributes?.industry as string | undefined;

            return (
              <Link key={company.id} href={`/companies/${company.id}`}>
                <Card className="transition-colors hover:border-primary/30 hover:shadow-md cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle className="text-base leading-tight">
                          {company.name}
                        </CardTitle>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {industry && (
                      <Badge variant="secondary">{industry}</Badge>
                    )}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        <span>
                          {company.contact_count}{" "}
                          {company.contact_count === 1
                            ? "contacto"
                            : "contactos"}
                        </span>
                      </div>
                      <span>{formatDate(company.last_seen)}</span>
                    </div>
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
