import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hilos",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
