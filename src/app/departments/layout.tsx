import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Departamentos",
  description: "Areas con KPIs y responsables",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
