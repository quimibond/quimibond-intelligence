import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quimibond Intelligence",
  description: "Business intelligence brain for Quimibond",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <Sidebar />
        <main className="pl-64">
          <div className="min-h-screen p-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
