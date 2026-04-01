import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Detalle de Agente | Quimibond Intelligence",
  description: "Vista detallada de un agente de IA con rendimiento, corridas, insights y memorias",
};

export default function AgentDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
