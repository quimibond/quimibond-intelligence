"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface Briefing {
  id: string;
  briefing_type: string;
  period_start: string;
  period_end: string;
  summary: string;
  html_content: string;
  created_at: string;
  account_email: string;
}

export default function BriefingDetailPage() {
  const params = useParams();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("briefings")
        .select("*")
        .eq("id", params.id)
        .single();
      setBriefing(data);
      setLoading(false);
    }
    fetch();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-pulse text-[var(--muted-foreground)]">Cargando briefing...</div>
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--muted-foreground)]">Briefing no encontrado.</p>
        <Link href="/briefings">
          <Button variant="ghost" className="mt-4">Volver a briefings</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/briefings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="info">{briefing.briefing_type}</Badge>
            {briefing.account_email && (
              <span className="text-sm text-[var(--muted-foreground)]">{briefing.account_email}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {new Date(briefing.created_at).toLocaleDateString("es-MX", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>

      {briefing.summary && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-[var(--muted-foreground)]">Resumen</p>
            <p className="mt-1 text-sm">{briefing.summary}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <div
            className="prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: briefing.html_content || "<p>Sin contenido.</p>" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
