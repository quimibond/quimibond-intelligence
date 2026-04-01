import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Competidores",
  description: "Monitoreo y analisis de competidores",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
