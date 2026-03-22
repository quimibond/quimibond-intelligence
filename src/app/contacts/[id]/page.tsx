"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";

type Contact = {
  id: string;
  email: string;
  name: string;
  company: string;
  contact_type: string;
  risk_level: "high" | "medium" | "low";
  sentiment_score: number;
  relationship_score: number;
  total_sent: number;
  total_received: number;
  last_interaction: string;
};

type PersonProfile = {
  canonical_key: string;
  name: string;
  email: string;
  company: string;
  role: string;
  department: string;
  decision_power: "high" | "medium" | "low";
  communication_style: string;
  negotiation_style: string;
  response_pattern: string;
  key_interests: string[];
  personality_notes: string;
  influence_on_deals: string;
};

type Fact = {
  id: string;
  entity_id: string;
  fact_text: string;
  fact_type: string;
  confidence: number;
  created_at: string;
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

const decisionPowerLabel: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contactId = params.id as string;

  const [contact, setContact] = useState<Contact | null>(null);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContactData();
  }, [contactId]);

  const fetchContactData = async () => {
    try {
      setLoading(true);

      // Fetch contact
      const { data: contactData, error: contactError } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", contactId)
        .single();

      if (contactError) throw contactError;
      setContact(contactData as Contact);

      // Fetch person profile
      const { data: profileData } = await supabase
        .from("person_profiles")
        .select("*")
        .eq("email", contactData.email)
        .single();

      if (profileData) {
        setProfile(profileData as PersonProfile);
      }

      // Fetch facts
      const { data: factsData } = await supabase
        .from("facts")
        .select("*")
        .eq("entity_id", contactId)
        .order("created_at", { ascending: false });

      if (factsData) {
        setFacts(factsData as Fact[]);
      }
    } catch (err) {
      console.error("Error fetching contact data:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Contacto no encontrado
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Volver
      </Button>

      {/* Contact Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">{contact.name}</h1>
              <p className="text-muted-foreground mt-1">{contact.company}</p>
              <p className="text-sm text-muted-foreground mt-1">{contact.email}</p>
              {profile?.role && (
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="font-semibold">Cargo:</span> {profile.role}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Badge
                variant={riskLevelVariant[contact.risk_level] as any}
              >
                {riskLevelLabel[contact.risk_level]}
              </Badge>
              <div className="text-right">
                <div className="text-xs text-muted-foreground mb-1">Sentimiento</div>
                <div className="text-sm font-semibold text-foreground">
                  {(contact.sentiment_score * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Section */}
      {profile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Perfil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-semibold mb-1">
                  Poder de Decisión
                </p>
                <p className="text-sm text-foreground">
                  {decisionPowerLabel[profile.decision_power]}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold mb-1">Departamento</p>
                <p className="text-sm text-foreground">{profile.department || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold mb-1">
                  Estilo de Comunicación
                </p>
                <p className="text-sm text-foreground">
                  {profile.communication_style || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold mb-1">
                  Estilo de Negociación
                </p>
                <p className="text-sm text-foreground">
                  {profile.negotiation_style || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold mb-1">
                  Patrón de Respuesta
                </p>
                <p className="text-sm text-foreground">{profile.response_pattern || "—"}</p>
              </div>
            </div>

            {profile.key_interests && profile.key_interests.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground font-semibold mb-2">
                  Intereses Clave
                </p>
                <div className="flex flex-wrap gap-2">
                  {profile.key_interests.map((interest, idx) => (
                    <Badge key={idx} variant="secondary">
                      {interest}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {profile.personality_notes && (
              <div>
                <p className="text-xs text-muted-foreground font-semibold mb-1">Personalidad</p>
                <p className="text-sm text-foreground">{profile.personality_notes}</p>
              </div>
            )}

            {profile.influence_on_deals && (
              <div>
                <p className="text-xs text-muted-foreground font-semibold mb-1">
                  Influencia en Tratos
                </p>
                <p className="text-sm text-foreground">{profile.influence_on_deals}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Facts Section */}
      {facts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Hechos Extraídos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {facts.map((fact) => (
                <div
                  key={fact.id}
                  className="p-3 bg-muted/50 rounded-lg border border-border"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      {fact.fact_type}
                    </Badge>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground mb-1">Confianza</div>
                      <div className="flex items-center gap-1">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-success"
                            style={{ width: `${fact.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {(fact.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-foreground">{fact.fact_text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Communication Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estadísticas de Comunicación</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground font-semibold mb-1">Enviados</p>
              <p className="text-2xl font-bold text-foreground">{contact.total_sent}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-semibold mb-1">Recibidos</p>
              <p className="text-2xl font-bold text-foreground">{contact.total_received}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-semibold mb-1">Total</p>
              <p className="text-2xl font-bold text-foreground">
                {contact.total_sent + contact.total_received}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
