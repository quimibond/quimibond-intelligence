import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Centro de Control",
  description: "Vista ejecutiva del negocio",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
