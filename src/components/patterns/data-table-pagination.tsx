"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationFirst,
  PaginationLast,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface DataTablePaginationProps {
  total: number;
  page: number;
  pageSize: number;
  pageKey?: string;
  pageSizeKey?: string;
  pageSizeOptions?: number[];
  /** Mismo prefijo que usas en DataTableToolbar. */
  paramPrefix?: string;
  /** Texto singular/plural (default: "registros") */
  unit?: string;
}

export function DataTablePagination({
  total,
  page,
  pageSize,
  pageKey = "page",
  pageSizeKey = "size",
  pageSizeOptions = [10, 25, 50, 100],
  paramPrefix = "",
  unit = "registros",
}: DataTablePaginationProps) {
  const fullPageKey = paramPrefix + pageKey;
  const fullSizeKey = paramPrefix + pageSizeKey;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(total, currentPage * pageSize);

  const buildHref = React.useCallback(
    (nextPage: number, nextSize?: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextPage <= 1) params.delete(fullPageKey);
      else params.set(fullPageKey, String(nextPage));
      if (nextSize) {
        if (nextSize === pageSizeOptions[0]) params.delete(fullSizeKey);
        else params.set(fullSizeKey, String(nextSize));
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams, fullPageKey, fullSizeKey, pageSizeOptions]
  );

  const goTo = (nextPage: number) => {
    router.replace(buildHref(nextPage), { scroll: false });
  };

  const handleSizeChange = (value: string) => {
    const size = Number(value);
    if (!Number.isFinite(size)) return;
    router.replace(buildHref(1, size), { scroll: false });
  };

  // Rango de páginas visibles (pattern: 1 ... curr-1 curr curr+1 ... last)
  const pages: Array<number | "…"> = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push("…");
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="flex flex-col items-center justify-between gap-3 px-1 py-2 sm:flex-row">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {total === 0 ? (
            <>Sin {unit}</>
          ) : (
            <>
              <span className="font-medium text-foreground">
                {from.toLocaleString("es-MX")}–{to.toLocaleString("es-MX")}
              </span>{" "}
              de <span className="font-medium text-foreground">{total.toLocaleString("es-MX")}</span> {unit}
            </>
          )}
        </span>
        <div className="hidden items-center gap-2 sm:flex">
          <span>Por página</span>
          <Select
            value={String(pageSize)}
            onValueChange={handleSizeChange}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((opt) => (
                <SelectItem key={opt} value={String(opt)}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationFirst
                href={buildHref(1)}
                aria-disabled={currentPage === 1}
                onClick={(e) => {
                  e.preventDefault();
                  if (currentPage > 1) goTo(1);
                }}
                className={currentPage === 1 ? "pointer-events-none opacity-40" : ""}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationPrevious
                href={buildHref(currentPage - 1)}
                aria-disabled={currentPage === 1}
                onClick={(e) => {
                  e.preventDefault();
                  if (currentPage > 1) goTo(currentPage - 1);
                }}
                className={currentPage === 1 ? "pointer-events-none opacity-40" : ""}
              />
            </PaginationItem>
            {pages.map((p, i) =>
              p === "…" ? (
                <PaginationItem key={`e-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    href={buildHref(p)}
                    isActive={p === currentPage}
                    onClick={(e) => {
                      e.preventDefault();
                      goTo(p);
                    }}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                href={buildHref(currentPage + 1)}
                aria-disabled={currentPage === totalPages}
                onClick={(e) => {
                  e.preventDefault();
                  if (currentPage < totalPages) goTo(currentPage + 1);
                }}
                className={
                  currentPage === totalPages ? "pointer-events-none opacity-40" : ""
                }
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationLast
                href={buildHref(totalPages)}
                aria-disabled={currentPage === totalPages}
                onClick={(e) => {
                  e.preventDefault();
                  if (currentPage < totalPages) goTo(totalPages);
                }}
                className={
                  currentPage === totalPages ? "pointer-events-none opacity-40" : ""
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
