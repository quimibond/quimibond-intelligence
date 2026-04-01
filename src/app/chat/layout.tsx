import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chat",
  description: "Asistente de inteligencia comercial con IA",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
