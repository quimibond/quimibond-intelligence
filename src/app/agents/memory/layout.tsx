import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Memorias de Agentes",
  description: "Browser de memorias persistentes de los agentes de IA",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
