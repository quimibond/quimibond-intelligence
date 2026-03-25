"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Building2, User, Bell, CheckSquare, Mail } from "lucide-react";

type EntityType = "company" | "contact" | "alert" | "action" | "email";

const CONFIG: Record<
  EntityType,
  {
    basePath: string;
    icon: typeof Building2;
    variant: "info" | "success" | "warning" | "critical" | "secondary";
  }
> = {
  company: { basePath: "/companies", icon: Building2, variant: "info" },
  contact: { basePath: "/contacts", icon: User, variant: "success" },
  alert: { basePath: "/alerts", icon: Bell, variant: "critical" },
  action: { basePath: "/actions", icon: CheckSquare, variant: "warning" },
  email: { basePath: "/emails", icon: Mail, variant: "secondary" },
};

interface EntityLinkProps {
  type: EntityType;
  id: number | string;
  label: string;
  className?: string;
}

export function EntityLink({ type, id, label, className }: EntityLinkProps) {
  const { basePath, icon: Icon, variant } = CONFIG[type];

  return (
    <Link href={`${basePath}/${id}`} className={className}>
      <Badge
        variant={variant}
        className="gap-1 hover:opacity-80 transition-opacity cursor-pointer"
      >
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    </Link>
  );
}
