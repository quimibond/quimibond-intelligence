"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { timeAgo, formatCurrency } from "@/lib/utils";
import type { Company } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { BatchEnrichButton } from "@/components/shared/batch-enrich-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Search,
  ArrowRight,
  MapPin,
  Sparkles,
} from "lucide-react";

const PAGE_SIZE = 60;

function buildCompanyQuery(search: string) {
  let q = supabase.from("companies").select("*").order("name");
  if (search.trim()) {
    q = q.ilike("name", `%${search.trim()}%`);
  }
  return q;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCompanies = useCallback(async (searchVal: string) => {
    setLoading(true);
    const { data } = await buildCompanyQuery(searchVal).range(0, PAGE_SIZE - 1);
    setCompanies((data ?? []) as Company[]);
    setHasMore((data ?? []).length === PAGE_SIZE);
    setLoading(false);
  }, []);

  useEffect(() => { fetchCompanies(""); }, [fetchCompanies]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCompanies(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, fetchCompanies]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await buildCompanyQuery(search)
      .range(companies.length, companies.length + PAGE_SIZE - 1);
    if (data) {
      setCompanies((prev) => [...prev, ...(data as Company[])]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas"
        description="Directorio de empresas e inteligencia comercial"
      >
        <BatchEnrichButton type="companies" />
      </PageHeader>

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
            <Skeleton key={i} className="h-[180px] w-full" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && companies.length === 0 && (
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
      {!loading && companies.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((company) => (
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
                  {/* Badges row */}
                  <div className="flex flex-wrap gap-1.5">
                    {company.industry && (
                      <Badge variant="secondary">{company.industry}</Badge>
                    )}
                    {company.is_customer && (
                      <Badge variant="success">Cliente</Badge>
                    )}
                    {company.is_supplier && (
                      <Badge variant="info">Proveedor</Badge>
                    )}
                  </div>

                  {/* Lifetime value */}
                  {company.lifetime_value != null && company.lifetime_value > 0 && (
                    <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(company.lifetime_value)}
                    </p>
                  )}

                  {/* Footer info */}
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    {(company.country || company.city) && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>
                          {[company.city, company.country]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </div>
                    )}
                    {company.enriched_at && (
                      <div className="flex items-center gap-1" title={`Enriquecido ${timeAgo(company.enriched_at)}`}>
                        <Sparkles className="h-3 w-3 text-amber-500" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && companies.length > 0 && !search && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Cargando..." : "Cargar mas empresas"}
          </Button>
        </div>
      )}
    </div>
  );
}
