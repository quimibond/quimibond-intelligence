"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FeedbackButtonsProps {
  table: "alerts" | "action_items";
  id: string | number;
  currentFeedback?: string | null;
  onFeedbackSaved?: () => void;
}

export function FeedbackButtons({
  table,
  id,
  currentFeedback,
  onFeedbackSaved,
}: FeedbackButtonsProps) {
  const [feedback, setFeedback] = useState<string | null | undefined>(
    currentFeedback
  );
  const [saving, setSaving] = useState(false);

  const negativeFeedback =
    table === "alerts" ? "false_positive" : "not_useful";
  const negativeLabel =
    table === "alerts" ? "Falso positivo" : "No util";

  async function saveFeedback(value: string) {
    if (saving) return;
    const newValue = feedback === value ? null : value;
    setSaving(true);
    try {
      // feedback_signals table removed — no-op
      setFeedback(newValue);
      onFeedbackSaved?.();
    } catch {
      // Fail silently if table/columns not available
    } finally {
      setSaving(false);
    }
  }

  return (
    <TooltipProvider>
      <div className="inline-flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 w-7 p-0",
                feedback === "useful" &&
                  "text-success-foreground bg-success/10"
              )}
              onClick={(e) => {
                e.stopPropagation();
                saveFeedback("useful");
              }}
              disabled={saving}
            >
              <ThumbsUp
                className={cn(
                  "h-3.5 w-3.5",
                  feedback === "useful" && "fill-current"
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Util</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 w-7 p-0",
                feedback === negativeFeedback &&
                  "text-danger-foreground bg-danger/10"
              )}
              onClick={(e) => {
                e.stopPropagation();
                saveFeedback(negativeFeedback);
              }}
              disabled={saving}
            >
              <ThumbsDown
                className={cn(
                  "h-3.5 w-3.5",
                  feedback === negativeFeedback && "fill-current"
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{negativeLabel}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
