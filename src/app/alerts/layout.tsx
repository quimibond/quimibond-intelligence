import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Alertas",
  description: "Alertas del sistema y notificaciones",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
