"use client";

import { Brain, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ProfileCardProps {
  contact: {
    name: string | null;
    role: string | null;
    decision_power: string | null;
    communication_style: string | null;
    language_preference: string | null;
    key_interests: unknown;
    personality_notes: string | null;
    negotiation_style: string | null;
    response_pattern: string | null;
    influence_on_deals: string | null;
  };
}

function decisionPowerColor(power: string | null): string {
  if (!power) return "bg-gray-400";
  const lower = power.toLowerCase();
  if (lower === "alto" || lower === "high") return "bg-emerald-500";
  if (lower === "medio" || lower === "medium") return "bg-amber-500";
  return "bg-gray-400";
}

function generateTips(contact: ProfileCardProps["contact"]): string[] {
  const tips: string[] = [];
  const dp = contact.decision_power?.toLowerCase() ?? "";
  const cs = contact.communication_style?.toLowerCase() ?? "";
  const ns = contact.negotiation_style?.toLowerCase() ?? "";
  const rp = contact.response_pattern?.toLowerCase() ?? "";

  if (dp === "alto" || dp === "high") {
    tips.push("Hablar directo, ofrecer datos concretos");
  } else if (dp === "medio" || dp === "medium") {
    tips.push("Presentar opciones claras para facilitar la decision");
  } else if (dp === "bajo" || dp === "low") {
    tips.push("Identificar al decisor real y preparar material de apoyo");
  }

  if (cs.includes("formal")) {
    tips.push("Mantener tono profesional");
  } else if (cs.includes("informal") || cs.includes("casual")) {
    tips.push("Se puede usar tono cercano y amigable");
  }

  if (ns.includes("agresiv")) {
    tips.push("Preparar argumentos solidos, no ceder rapido");
  } else if (ns.includes("colaborativ")) {
    tips.push("Buscar soluciones win-win, enfocarse en valor mutuo");
  }

  if (rp.includes("lent") || rp.includes("slow")) {
    tips.push("Dar seguimiento sin presionar, ser paciente");
  } else if (rp.includes("rapid") || rp.includes("fast")) {
    tips.push("Responder rapido para mantener el momentum");
  }

  return tips.slice(0, 3);
}

function FieldValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">
        {value ?? <span className="text-muted-foreground font-normal">Sin datos</span>}
      </p>
    </div>
  );
}

export function ProfileCard({ contact }: ProfileCardProps) {
  const keyInterests: string[] = Array.isArray(contact.key_interests)
    ? (contact.key_interests as string[])
    : [];

  const tips = generateTips(contact);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-5 w-5" />
          Perfil de Inteligencia
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Grid of fields */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldValue label="Rol" value={contact.role} />
          <div>
            <p className="text-xs text-muted-foreground">Poder de decision</p>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${decisionPowerColor(contact.decision_power)}`}
              />
              <span className="text-sm font-medium">
                {contact.decision_power ?? (
                  <span className="text-muted-foreground font-normal">Sin datos</span>
                )}
              </span>
            </div>
          </div>
          <FieldValue label="Estilo de comunicacion" value={contact.communication_style} />
          <FieldValue label="Idioma preferido" value={contact.language_preference} />
          <FieldValue label="Estilo de negociacion" value={contact.negotiation_style} />
          <FieldValue label="Patron de respuesta" value={contact.response_pattern} />
          <FieldValue label="Influencia en deals" value={contact.influence_on_deals} />
        </div>

        {/* Key interests */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Intereses clave</p>
          {keyInterests.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {keyInterests.map((interest) => (
                <Badge key={interest} variant="outline">
                  {interest}
                </Badge>
              ))}
            </div>
          ) : (
            typeof contact.key_interests === "string" && contact.key_interests ? (
              <p className="text-sm">{contact.key_interests}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Sin datos</p>
            )
          )}
        </div>

        {/* Personality notes */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Notas de personalidad</p>
          {contact.personality_notes ? (
            <blockquote className="border-l-2 border-muted-foreground/30 pl-4 text-sm italic leading-relaxed text-muted-foreground">
              {contact.personality_notes}
            </blockquote>
          ) : (
            <p className="text-sm text-muted-foreground">Sin datos</p>
          )}
        </div>

        {/* Negotiation tips */}
        {tips.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5" />
              Tips de negociacion
            </p>
            <ul className="space-y-1.5">
              {tips.map((tip) => (
                <li
                  key={tip}
                  className="flex items-start gap-2 text-sm"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
