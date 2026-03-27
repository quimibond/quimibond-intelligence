import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analitica",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
