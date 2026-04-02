"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

export interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  href: string;
  variant?: "default" | "danger" | "warning" | "success" | "info";
  className?: string;
}

const colors = {
  default: "hover:border-foreground/20",
  danger: "border-danger/30 bg-danger/5 hover:bg-danger/10",
  warning: "border-warning/30 bg-warning/5 hover:bg-warning/10",
  success: "border-success/30 bg-success/5 hover:bg-success/10",
  info: "border-info/30 bg-info/5 hover:bg-info/10",
};

const iconColors = {
  default: "text-muted-foreground",
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  info: "text-info",
};

const valueColors = {
  default: "",
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  info: "text-info",
};

export function KPICard({
  title, value, subtitle, icon: Icon, href, variant = "default", className,
}: KPICardProps) {
  return (
    <Link href={href} className={cn("block group", className)}>
      <Card className={cn("transition-all cursor-pointer h-full", colors[variant])}>
        <CardContent className="p-3 sm:pt-4 sm:pb-3 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs text-muted-foreground min-w-0">
              <Icon className={cn("h-3 w-3 sm:h-4 sm:w-4 shrink-0", iconColors[variant])} />
              <span className="truncate leading-tight">{title}</span>
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground transition-all shrink-0 hidden sm:block" />
          </div>
          <p className={cn("mt-1 text-lg sm:text-2xl font-bold tabular-nums truncate", valueColors[variant])}>
            {value}
          </p>
          {subtitle && (
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 truncate hidden sm:block">{subtitle}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
