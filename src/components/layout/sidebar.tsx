"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Brain,
  LayoutDashboard,
  MessageSquare,
  FileText,
  AlertTriangle,
  CheckSquare,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Preguntar", icon: MessageSquare },
  { href: "/briefings", label: "Briefings", icon: FileText },
  { href: "/alerts", label: "Alertas", icon: AlertTriangle },
  { href: "/actions", label: "Acciones", icon: CheckSquare },
  { href: "/contacts", label: "Contactos", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[var(--border)] bg-[var(--background)]">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-6 border-b border-[var(--border)]">
        <Brain className="h-7 w-7 text-[var(--primary)]" />
        <div>
          <p className="font-bold text-sm">Quimibond</p>
          <p className="text-xs text-[var(--muted-foreground)]">Intelligence</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border)] p-4">
        <p className="text-xs text-[var(--muted-foreground)]">
          Intelligence System v5.0
        </p>
      </div>
    </aside>
  );
}
