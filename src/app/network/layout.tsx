import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Red de Comunicacion",
  description: "Grafo interactivo de comunicaciones",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
