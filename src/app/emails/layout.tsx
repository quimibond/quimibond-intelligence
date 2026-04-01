import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Emails",
  description: "Correos sincronizados e inteligencia extraida",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
