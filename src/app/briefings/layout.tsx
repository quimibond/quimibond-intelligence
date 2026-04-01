import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Briefings",
  description: "Resumenes diarios y reportes ejecutivos",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
