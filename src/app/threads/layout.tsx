import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hilos",
  description: "Hilos de conversacion y seguimiento",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
