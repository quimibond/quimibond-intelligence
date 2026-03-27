import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Red de Comunicacion",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
