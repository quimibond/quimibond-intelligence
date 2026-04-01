import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Routing de Insights",
  description: "Reglas de asignacion automatica por departamento",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
