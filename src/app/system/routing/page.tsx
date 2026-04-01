"use client";

import { useEffect, useState } from "react";
import { Route } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoutingRule = Record<string, any>;

export default function RoutingPage() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      // Try the join first; fall back to select("*") if it fails
      let data: RoutingRule[] | null = null;

      const joined = await supabase
        .from("insight_routing")
        .select("*, departments(name, lead_name, lead_email)")
        .order("category", { ascending: true });

      if (joined.error) {
        // Fallback: plain select
        const plain = await supabase
          .from("insight_routing")
          .select("*")
          .order("id", { ascending: true });
        data = plain.data;
      } else {
        data = joined.data;
      }

      if (data && data.length > 0) {
        // Detect available columns from the first row
        setColumns(Object.keys(data[0]));
      }

      setRules(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: "Sistema", href: "/system" },
            { label: "Routing" },
          ]}
        />
        <PageHeader
          title="Routing de Insights"
          description="Reglas de asignacion automatica por departamento"
        />
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  // Determine which fields exist so we render what the table actually has
  const hasCategory = columns.includes("category");
  const hasKeywords = columns.includes("keywords");
  const hasDepartments = columns.includes("departments");
  const hasDepartmentId = columns.includes("department_id");
  const hasIsActive = columns.includes("is_active");

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Sistema", href: "/system" },
          { label: "Routing" },
        ]}
      />

      <PageHeader
        title="Routing de Insights"
        description="Reglas de asignacion automatica por departamento"
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={Route}
          title="Sin reglas de routing"
          description="No se encontraron reglas de asignacion. Agrega reglas en la tabla insight_routing para enrutar insights automaticamente."
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {hasCategory && <TableHead>Categoria</TableHead>}
                    {hasKeywords && <TableHead>Keywords</TableHead>}
                    {(hasDepartments || hasDepartmentId) && (
                      <TableHead>Departamento</TableHead>
                    )}
                    {hasDepartments && <TableHead>Responsable</TableHead>}
                    {hasIsActive && <TableHead>Estado</TableHead>}
                    {/* Fallback: render all columns if none of the expected ones exist */}
                    {!hasCategory &&
                      !hasKeywords &&
                      !hasDepartments &&
                      !hasIsActive &&
                      columns
                        .filter((c) => c !== "id")
                        .map((col) => <TableHead key={col}>{col}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule, idx) => {
                    const dept = rule.departments as
                      | { name?: string; lead_name?: string; lead_email?: string }
                      | null;
                    const keywords: string[] = Array.isArray(rule.keywords)
                      ? rule.keywords
                      : [];

                    // If none of the expected columns exist, render raw values
                    const useFallback =
                      !hasCategory &&
                      !hasKeywords &&
                      !hasDepartments &&
                      !hasIsActive;

                    return (
                      <TableRow key={rule.id ?? idx}>
                        {useFallback ? (
                          columns
                            .filter((c) => c !== "id")
                            .map((col) => (
                              <TableCell key={col}>
                                {typeof rule[col] === "boolean" ? (
                                  rule[col] ? "Si" : "No"
                                ) : Array.isArray(rule[col]) ? (
                                  <div className="flex flex-wrap gap-1">
                                    {(rule[col] as string[]).map(
                                      (v: string, i: number) => (
                                        <Badge
                                          key={i}
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          {String(v)}
                                        </Badge>
                                      )
                                    )}
                                  </div>
                                ) : typeof rule[col] === "object" &&
                                  rule[col] !== null ? (
                                  <span className="text-xs text-muted-foreground">
                                    {JSON.stringify(rule[col])}
                                  </span>
                                ) : (
                                  String(rule[col] ?? "—")
                                )}
                              </TableCell>
                            ))
                        ) : (
                          <>
                            {hasCategory && (
                              <TableCell className="font-medium">
                                {rule.category ?? "—"}
                              </TableCell>
                            )}
                            {hasKeywords && (
                              <TableCell>
                                {keywords.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {keywords.map((kw, i) => (
                                      <Badge
                                        key={i}
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        {kw}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </TableCell>
                            )}
                            {(hasDepartments || hasDepartmentId) && (
                              <TableCell>
                                {dept?.name ?? rule.department_name ?? "—"}
                              </TableCell>
                            )}
                            {hasDepartments && (
                              <TableCell>
                                <div>
                                  <p className="text-sm">
                                    {dept?.lead_name ?? "—"}
                                  </p>
                                  {dept?.lead_email && (
                                    <p className="text-xs text-muted-foreground">
                                      {dept.lead_email}
                                    </p>
                                  )}
                                </div>
                              </TableCell>
                            )}
                            {hasIsActive && (
                              <TableCell>
                                <Badge
                                  variant={
                                    rule.is_active ? "success" : "secondary"
                                  }
                                >
                                  {rule.is_active ? "Activo" : "Inactivo"}
                                </Badge>
                              </TableCell>
                            )}
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {rules.length} regla{rules.length !== 1 ? "s" : ""} de routing
              configurada{rules.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
