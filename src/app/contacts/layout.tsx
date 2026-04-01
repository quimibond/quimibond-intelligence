import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contactos",
  description: "Directorio de contactos con inteligencia relacional",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
