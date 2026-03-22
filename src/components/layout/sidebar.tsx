"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Crosshair,
  Mail,
  MessageSquare,
  FileText,
  AlertTriangle,
  Target,
  Users,
  Network,
  Settings,
  Zap,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Comando", icon: Crosshair, color: "text-cyan-400" },
  { href: "/emails", label: "Emails", icon: Mail, color: "text-blue-400" },
  { href: "/chat", label: "Preguntar", icon: MessageSquare, color: "text-purple-400" },
  { href: "/briefings", label: "Reportes", icon: FileText, color: "text-indigo-400" },
  { href: "/alerts", label: "Alertas", icon: AlertTriangle, color: "text-amber-400" },
  { href: "/actions", label: "Misiones", icon: Target, color: "text-pink-400" },
  { href: "/contacts", label: "Contactos", icon: Users, color: "text-emerald-400" },
  { href: "/knowledge", label: "Knowledge", icon: Network, color: "text-teal-400" },
  { href: "/system", label: "Sistema", icon: Settings, color: "text-gray-400" },
];

export function Sidebar() {
  const pathname = usePathname();

  if (pathname === "/login") return null;

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[var(--border)] bg-[var(--background)]">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-6 border-b border-[var(--border)]">
        <div className="relative">
          <Zap className="h-7 w-7 text-cyan-400" />
          <div className="absolute inset-0 h-7 w-7 text-cyan-400 blur-sm opacity-50">
            <Zap className="h-7 w-7" />
          </div>
        </div>
        <div>
          <p className="font-black text-sm tracking-tight">QUIMIBOND</p>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">Intelligence</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] px-3 py-2">
          Navegacion
        </div>
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/50 hover:text-[var(--foreground)]",
              )}
            >
              <item.icon className={cn("h-4 w-4", isActive ? item.color : "")} />
              {item.label}
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border)] p-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Sistema Operativo v5.0
          </p>
        </div>
      </div>
    </aside>
  );
}
