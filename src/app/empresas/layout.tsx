import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Empresas",
  description: "Directorio de empresas e inteligencia comercial",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
