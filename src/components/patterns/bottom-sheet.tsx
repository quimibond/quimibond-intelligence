"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Fuerza un lado independientemente del viewport */
  side?: "bottom" | "right";
}

/**
 * BottomSheet — mobile bottom drawer, desktop right panel.
 * Usar en lugar de Dialog para detalles/forms. Mejor UX mobile.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  side,
}: BottomSheetProps) {
  const isMobile = useMobile();
  const effectiveSide = side ?? (isMobile ? "bottom" : "right");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={effectiveSide}
        className={cn(
          effectiveSide === "bottom" &&
            "max-h-[90vh] overflow-y-auto rounded-t-2xl",
          effectiveSide === "right" && "w-full sm:max-w-md",
          className
        )}
      >
        {(title || description) && (
          <SheetHeader className="border-b border-border pb-3">
            {title && <SheetTitle>{title}</SheetTitle>}
            {description && (
              <SheetDescription>{description}</SheetDescription>
            )}
          </SheetHeader>
        )}
        <div className="pt-3">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
