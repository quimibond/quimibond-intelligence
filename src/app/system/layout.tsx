import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sistema",
  description: "Estado del sistema, pipelines y sincronizacion",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
