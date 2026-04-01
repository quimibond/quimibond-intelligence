"use client";

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function TokenUsageCard() {
  const [usage, setUsage] = useState<{ endpoint: string; total_in: number; total_out: number; calls: number }[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("token_usage")
        .select("endpoint, input_tokens, output_tokens")
        .gte("created_at", thirtyDaysAgo);

      if (!data || data.length === 0) { setLoading(false); return; }

      const map = new Map<string, { total_in: number; total_out: number; calls: number }>();
      let sumIn = 0, sumOut = 0;
      for (const row of data) {
        if (!map.has(row.endpoint)) map.set(row.endpoint, { total_in: 0, total_out: 0, calls: 0 });
        const e = map.get(row.endpoint)!;
        e.total_in += row.input_tokens;
        e.total_out += row.output_tokens;
        e.calls++;
        sumIn += row.input_tokens;
        sumOut += row.output_tokens;
      }
      setUsage(Array.from(map.entries()).map(([endpoint, v]) => ({ endpoint, ...v })).sort((a, b) => b.total_in + b.total_out - (a.total_in + a.total_out)));
      setTotalIn(sumIn);
      setTotalOut(sumOut);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <Skeleton className="h-[200px]" />;
  if (usage.length === 0) return null;

  const estimatedCost = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Brain className="h-5 w-5 text-domain-meta" />
        <CardTitle className="text-base">Claude API (30 dias)</CardTitle>
        <Badge variant="secondary" className="ml-auto">~${estimatedCost.toFixed(2)} USD</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3 mb-4">
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{(totalIn / 1000).toFixed(1)}K</p>
            <p className="text-xs text-muted-foreground">Input tokens</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{(totalOut / 1000).toFixed(1)}K</p>
            <p className="text-xs text-muted-foreground">Output tokens</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{usage.reduce((s, u) => s + u.calls, 0)}</p>
            <p className="text-xs text-muted-foreground">Llamadas</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead className="text-right">Llamadas</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.map((u) => (
                <TableRow key={u.endpoint}>
                  <TableCell className="font-medium">{u.endpoint}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.total_in.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.total_out.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
