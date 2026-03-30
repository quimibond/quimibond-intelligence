import type { Metadata } from "next";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { MainContent } from "@/components/layout/main-content";
import { SearchCommand } from "@/components/shared/search-command";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Quimibond Intelligence",
    template: "%s | Quimibond Intelligence",
  },
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
            __html: `(function(){try{var t=localStorage.getItem("qb-theme");var p=window.matchMedia("(prefers-color-scheme:dark)").matches;document.documentElement.classList.toggle("dark",t?t==="dark":p)}catch(e){document.documentElement.classList.add("dark")}})()`,
          }}
        />
      </head>
      <body>
        <SidebarProvider>
          <AppSidebar />
          <MainContent>{children}</MainContent>
          <SearchCommand />
          <Toaster
            position="bottom-right"
            toastOptions={{
              className: "!bg-card !text-card-foreground !border-border",
            }}
          />
        </SidebarProvider>
      </body>
    </html>
  );
}
