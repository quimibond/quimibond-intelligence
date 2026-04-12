"use client";

import Link from "next/link";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Clickable card primitive — the single source of truth for the "card that's
 * also a link or button" pattern. Replaces 25+ duplicates across the app that
 * used raw divs with rounded-xl + border + bg-card + shadow-sm classes.
 *
 * USE CASES:
 * - `<LinkCard href="/inbox/123">` — renders as <Link>
 * - `<LinkCard as="button" onClick={...}>` — renders as <button>
 * - `<LinkCard as="a" href="mailto:...">` — renders as plain <a> (external/mailto)
 *
 * The visual style matches shadcn's <Card> output exactly so card-based UIs
 * are consistent. All variants get:
 *   - rounded-xl, border, bg-card, shadow-sm, text-card-foreground
 *   - Hover: bg-muted/50 + border-primary/30
 *   - Focus-visible: ring-2 ring-ring (keyboard accessibility)
 *
 * Props:
 * @param as         "link" (default, next/link) | "a" | "button"
 * @param href       URL (for link/a variants)
 * @param interactive When false, disables hover/focus styles (use for static cards)
 */

type LinkCardBaseProps = {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
};

type LinkCardAsLink = LinkCardBaseProps & {
  as?: "link";
  href: string;
} & Omit<ComponentPropsWithoutRef<typeof Link>, "className" | "href" | "children">;

type LinkCardAsAnchor = LinkCardBaseProps & {
  as: "a";
  href: string;
} & Omit<ComponentPropsWithoutRef<"a">, "className" | "href" | "children">;

type LinkCardAsButton = LinkCardBaseProps & {
  as: "button";
  href?: never;
} & Omit<ComponentPropsWithoutRef<"button">, "className" | "children">;

type LinkCardProps = LinkCardAsLink | LinkCardAsAnchor | LinkCardAsButton;

const BASE_STYLES =
  "block rounded-xl border bg-card text-card-foreground shadow-sm transition-all";
const INTERACTIVE_STYLES =
  "hover:bg-muted/50 hover:border-primary/30 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-1";

export const LinkCard = forwardRef<HTMLElement, LinkCardProps>(function LinkCard(
  props,
  ref
) {
  const { children, className, interactive = true } = props;
  const combined = cn(
    BASE_STYLES,
    interactive && INTERACTIVE_STYLES,
    className
  );

  if (props.as === "button") {
    const { as: _as, className: _cn, interactive: _int, children: _ch, ...rest } = props;
    void _as; void _cn; void _int; void _ch;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cn(combined, "w-full text-left")}
        {...rest}
      >
        {children}
      </button>
    );
  }

  if (props.as === "a") {
    const { as: _as, className: _cn, interactive: _int, children: _ch, ...rest } = props;
    void _as; void _cn; void _int; void _ch;
    return (
      <a ref={ref as React.Ref<HTMLAnchorElement>} className={combined} {...rest}>
        {children}
      </a>
    );
  }

  // Default: next/link
  const { as: _as, className: _cn, interactive: _int, children: _ch, ...rest } = props as LinkCardAsLink;
  void _as; void _cn; void _int; void _ch;
  return (
    <Link ref={ref as React.Ref<HTMLAnchorElement>} className={combined} {...rest}>
      {children}
    </Link>
  );
});
