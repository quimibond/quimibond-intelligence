"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Hide en mobile (< sm). La versión mobile usa mobileCard. */
  hideOnMobile?: boolean;
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  /** Render para mobile. Si falta, se apila tabla con scroll horizontal. */
  mobileCard?: (row: T, index: number) => React.ReactNode;
  emptyState?: {
    icon: LucideIcon;
    title: string;
    description?: string;
  };
  rowKey?: (row: T, index: number) => string | number;
  className?: string;
  caption?: string;
}

/**
 * DataTable — responsive.
 * Desktop: tabla shadcn.
 * Mobile: card list usando `mobileCard`.
 */
export function DataTable<T>({
  data,
  columns,
  mobileCard,
  emptyState,
  rowKey,
  className,
  caption,
}: DataTableProps<T>) {
  if (!data || data.length === 0) {
    if (emptyState) {
      return (
        <EmptyState
          icon={emptyState.icon}
          title={emptyState.title}
          description={emptyState.description}
        />
      );
    }
    return null;
  }

  const getKey = (row: T, i: number) =>
    rowKey ? rowKey(row, i) : i;

  const alignClass = (a?: DataTableColumn<T>["align"]) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "";

  return (
    <>
      {/* Mobile: card list */}
      {mobileCard && (
        <div className={cn("flex flex-col gap-2 sm:hidden", className)}>
          {data.map((row, i) => (
            <React.Fragment key={getKey(row, i)}>
              {mobileCard(row, i)}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Desktop: table */}
      <Card
        className={cn(
          "overflow-hidden py-0",
          mobileCard ? "hidden sm:block" : "",
          className
        )}
      >
        <div className="overflow-x-auto">
          <Table>
            {caption && <caption className="sr-only">{caption}</caption>}
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={cn(
                      alignClass(col.align),
                      col.hideOnMobile && "hidden md:table-cell",
                      col.className
                    )}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, i) => (
                <TableRow key={getKey(row, i)}>
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        alignClass(col.align),
                        col.hideOnMobile && "hidden md:table-cell",
                        col.className
                      )}
                    >
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  );
}
