import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentos CFDI",
  description: "Visor de documentos CFDI parseados",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
