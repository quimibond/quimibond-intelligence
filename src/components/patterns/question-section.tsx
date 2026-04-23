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
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps a page section with a question as the heading. Use this instead of
 * ad-hoc Card + CardTitle when a section answers a concrete user question.
 * Every SP13+ page section should be framed as a question.
 */
export function QuestionSection({
  id,
  question,
  subtext,
  actions,
  children,
  className,
}: QuestionSectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-24 space-y-3", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{question}</h2>
          {subtext && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
