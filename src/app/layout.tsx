import type { Metadata } from "next";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { MainContent } from "@/components/layout/main-content";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { RealtimeAlerts } from "@/components/shared/realtime-alerts";
import { SearchCommand } from "@/components/shared/search-command";
import { TooltipProvider } from "@/components/ui/tooltip";
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
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Prevent flash: apply theme before paint. Respect stored choice, fallback to system preference only. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("qb-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme:dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
          Ir al contenido principal
        </a>
        <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <MainContent>{children}</MainContent>
          <MobileTabBar />
          <SearchCommand />
          <RealtimeAlerts />
          <Toaster
            position="bottom-right"
            toastOptions={{
              className: "!bg-card !text-card-foreground !border-border",
            }}
          />
        </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
