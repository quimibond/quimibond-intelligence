"use client";

import { timeAgo } from "@/lib/utils";
import type { Contact } from "@/lib/types";
import { ProfileCard } from "@/components/shared/profile-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TabPerfilProps {
  contact: Contact;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  personProfile: any;
}

export function TabPerfil({ contact, personProfile }: TabPerfilProps) {
  return (
    <div className="space-y-6">
      <ProfileCard contact={contact} />

      {/* Person Profile (consolidated into contacts table) */}
      {personProfile && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Perfil de Personalidad</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {Array.isArray(personProfile.personality_traits) && personProfile.personality_traits.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Rasgos de personalidad</p>
                <div className="flex flex-wrap gap-1.5">
                  {personProfile.personality_traits.map((t: string, i: number) => (
                    <Badge key={i} variant="outline">{t}</Badge>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(personProfile.decision_factors) && personProfile.decision_factors.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Factores de decision</p>
                <div className="flex flex-wrap gap-1.5">
                  {personProfile.decision_factors.map((f: string, i: number) => (
                    <Badge key={i} variant="info">{f}</Badge>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(personProfile.interests) && personProfile.interests.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Intereses</p>
                <div className="flex flex-wrap gap-1.5">
                  {personProfile.interests.map((i: string, idx: number) => (
                    <Badge key={idx} variant="secondary">{i}</Badge>
                  ))}
                </div>
              </div>
            )}
            {personProfile.summary && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Resumen</p>
                <p className="text-sm">{personProfile.summary}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Additional info */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {contact.department && (
              <div>
                <p className="text-xs text-muted-foreground">Departamento</p>
                <p className="text-sm font-medium">{contact.department}</p>
              </div>
            )}
            {contact.avg_response_time_hours != null && (
              <div>
                <p className="text-xs text-muted-foreground">Tiempo respuesta promedio</p>
                <p className="text-sm font-medium">{contact.avg_response_time_hours.toFixed(1)}h</p>
              </div>
            )}
            {contact.last_activity && (
              <div>
                <p className="text-xs text-muted-foreground">Ultima actividad</p>
                <p className="text-sm font-medium">{timeAgo(contact.last_activity)}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {contact.is_customer && <Badge variant="success">Cliente</Badge>}
            {contact.is_supplier && <Badge variant="info">Proveedor</Badge>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
