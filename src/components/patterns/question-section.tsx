import { cn } from "@/lib/utils";

export interface QuestionSectionProps {
  /** Id used for SectionNav anchoring. */
  id: string;
  /** The question this section answers. Rendered as h2. */
  question: string;
  /** Optional one-line clarification below the question. */
  subtext?: string;
  /** Right-aligned actions (period selector, export button, etc.). */
  actions?: React.ReactNode;
  /** Render as <details> so the user can expand/collapse. Default: false. */
  collapsible?: boolean;
  /** When collapsible, start expanded? Default: false. */
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps a page section with a question as the heading. Use this instead of
 * ad-hoc Card + CardTitle when a section answers a concrete user question.
 * Every SP13+ page section should be framed as a question.
 *
 * When `collapsible` is true, renders as a native <details>/<summary>
 * disclosure (no JS needed, server-rendered, keyboard accessible). Use for
 * drilldowns that are not part of the daily glance.
 */
export function QuestionSection({
  id,
  question,
  subtext,
  actions,
  collapsible = false,
  defaultOpen = true,
  children,
  className,
}: QuestionSectionProps) {
  if (!collapsible) {
    return (
      <section id={id} className={cn("scroll-mt-24 space-y-3", className)}>
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{question}</h2>
            {subtext && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </header>
        {children}
      </section>
    );
  }

  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      <details
        open={defaultOpen}
        className="group rounded-lg border bg-card open:shadow-sm"
      >
        <summary
          className={cn(
            "flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3",
            "hover:bg-muted/30 group-open:border-b group-open:bg-muted/15"
          )}
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <svg
              aria-hidden
              viewBox="0 0 12 12"
              className="mt-1 size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            >
              <path
                d="M4 2 L8 6 L4 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{question}</h2>
              {subtext && (
                <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </summary>
        <div className="space-y-3 p-4">{children}</div>
      </details>
    </section>
  );
}
