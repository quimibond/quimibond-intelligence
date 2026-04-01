import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analítica",
  description: "Metricas y analisis del negocio",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
