import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Equipo",
  description: "Empleados, actividades y metricas de ejecucion",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
