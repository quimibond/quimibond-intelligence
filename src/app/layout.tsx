import type { Metadata } from "next";
import { AppSidebar } from "@/components/layout/app-sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quimibond Intelligence",
  description: "Plataforma de inteligencia comercial",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="dark">
        <AppSidebar />
        <main className="pl-64">
          <div className="min-h-screen p-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
