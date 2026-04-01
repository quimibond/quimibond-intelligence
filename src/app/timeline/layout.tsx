import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Timeline",
  description: "Linea de tiempo de eventos del negocio",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
