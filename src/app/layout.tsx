import type { Metadata } from "next";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SearchCommand } from "@/components/shared/search-command";
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
      <head>
        {/* Prevent flash: apply theme before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("qb-theme");document.documentElement.classList.toggle("dark",t?t==="dark":true)}catch(e){document.documentElement.classList.add("dark")}})()`,
          }}
        />
      </head>
      <body>
        <AppSidebar />
        <main className="md:pl-64">
          <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">{children}</div>
        </main>
        <SearchCommand />
      </body>
    </html>
  );
}
