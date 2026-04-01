"use client";

import Link from "next/link";
import { scoreToPercent } from "@/lib/utils";
import { RiskBadge } from "@/components/shared/risk-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, Users } from "lucide-react";

interface ContactAtRisk {
  id: number;
  name: string;
  risk_level: string;
  relationship_score: number | null;
}

interface ContactsRiskProps {
  contacts: ContactAtRisk[];
  totalContacts: number;
}

export function ContactsRisk({ contacts, totalContacts }: ContactsRiskProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <Link href="/contacts" className="flex items-center justify-between group">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-danger" />
            <CardTitle className="text-sm sm:text-base">Contactos en Riesgo</CardTitle>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {totalContacts === 0
              ? "Sin contactos — sincroniza desde Sistema"
              : "Sin contactos en riesgo alto"}
          </p>
        ) : (
          <div className="space-y-1.5">
            {contacts.map((c) => (
              <Link
                key={c.id}
                href={`/contacts/${c.id}`}
                className="flex items-center gap-2 sm:gap-3 rounded-lg border p-2 sm:p-2.5 hover:bg-muted/50 transition-colors"
              >
                <RiskBadge level={c.risk_level} />
                <span className="text-sm font-medium truncate flex-1 min-w-0">
                  {c.name}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Progress
                    value={scoreToPercent(c.relationship_score)}
                    className="h-1.5 w-10 sm:w-16"
                  />
                  <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">
                    {c.relationship_score ?? 0}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
