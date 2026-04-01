"use client";

import React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn, timeAgo, truncate } from "@/lib/utils";
import type { Thread, Email } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  formatHoursWithout,
  urgencyBadgeVariant,
  urgencyLabel,
  rowBgClass,
  senderTypeVariant,
  senderTypeLabel,
} from "./thread-utils";

// ---------------------------------------------------------------------------
// Thread row + expansion
// ---------------------------------------------------------------------------

export interface ThreadRowProps {
  thread: Thread;
  isExpanded: boolean;
  emails: Email[] | undefined;
  isLoadingEmails: boolean;
  onToggle: () => void;
}

export const ThreadRow = React.memo(function ThreadRow({
  thread,
  isExpanded,
  emails,
  isLoadingEmails,
  onToggle,
}: ThreadRowProps) {
  const hours = thread.hours_without_response;
  const participants = thread.participant_emails ?? [];
  const displayParticipants = participants.slice(0, 3);
  const extraCount = participants.length - displayParticipants.length;

  return (
    <>
      <TableRow
        className={cn(
          "cursor-pointer transition-colors hover:bg-muted/50",
          rowBgClass(hours)
        )}
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Colapsar" : "Expandir"} hilo: ${thread.subject}`}
      >
        {/* Chevron */}
        <TableCell className="w-8 px-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>

        {/* Asunto */}
        <TableCell className="max-w-[260px] font-medium">
          <Link href={`/threads/${thread.id}`} className="hover:underline">
            {truncate(thread.subject, 55) || "\u2014"}
          </Link>
        </TableCell>

        {/* Participantes */}
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {displayParticipants.map((email) => (
              <Badge
                key={email}
                variant="secondary"
                className="max-w-[160px] truncate text-[10px] font-normal"
              >
                {email}
              </Badge>
            ))}
            {extraCount > 0 && (
              <Badge variant="outline" className="text-[10px] font-normal">
                +{extraCount}
              </Badge>
            )}
          </div>
        </TableCell>

        {/* Mensajes */}
        <TableCell className="text-center tabular-nums">
          {thread.message_count}
        </TableCell>

        {/* Ultimo remitente */}
        <TableCell>
          <div className="flex items-center gap-2">
            <Link href={`/contacts?q=${encodeURIComponent(thread.last_sender ?? "")}`} className="text-sm hover:underline">
              {truncate(thread.last_sender, 30) || "\u2014"}
            </Link>
            {thread.last_sender_type && (
              <Badge
                variant={senderTypeVariant(thread.last_sender_type)}
                className="text-[10px]"
              >
                {senderTypeLabel(thread.last_sender_type)}
              </Badge>
            )}
          </div>
        </TableCell>

        {/* Sin respuesta */}
        <TableCell className="whitespace-nowrap tabular-nums font-medium">
          {formatHoursWithout(hours)}
        </TableCell>

        {/* Estado */}
        <TableCell>
          <Badge variant={urgencyBadgeVariant(hours)}>
            {urgencyLabel(hours)}
          </Badge>
        </TableCell>

        {/* Fecha */}
        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
          {timeAgo(thread.created_at)}
        </TableCell>
      </TableRow>

      {/* Expanded: thread emails */}
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30 p-4">
            {isLoadingEmails ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !emails || emails.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No se encontraron emails para este hilo.
              </p>
            ) : (
              <div className="space-y-2">
                {emails.map((email) => (
                  <div
                    key={email.id}
                    className={cn(
                      "rounded-lg border bg-background p-3",
                      email.sender_type === "outbound"
                        ? "border-info/30"
                        : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">
                          {email.sender || "\u2014"}
                        </span>
                        {email.sender_type && (
                          <Badge
                            variant={senderTypeVariant(email.sender_type)}
                            className="shrink-0 text-[10px]"
                          >
                            {senderTypeLabel(email.sender_type)}
                          </Badge>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(email.email_date)}
                      </span>
                    </div>
                    {email.snippet && (
                      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                        {truncate(email.snippet, 200)}
                      </p>
                    )}
                    <Link href={`/emails/${email.id}`} className="mt-1 inline-block text-xs text-primary hover:underline">
                      Ver email completo
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
});
