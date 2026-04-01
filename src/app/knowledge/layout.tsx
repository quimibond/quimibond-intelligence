import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Knowledge Graph",
  description: "Entidades, relaciones y hechos del knowledge graph",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
