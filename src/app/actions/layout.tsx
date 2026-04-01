import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acciones",
  description: "Acciones pendientes y seguimiento de tareas",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
