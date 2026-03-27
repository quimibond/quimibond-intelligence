"use client";

import DOMPurify from "isomorphic-dompurify";

interface SanitizedHtmlProps {
  html: string;
  className?: string;
}

export function SanitizedHtml({ html, className }: SanitizedHtmlProps) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "ul", "ol", "li",
      "strong", "b", "em", "i", "u", "s", "del",
      "a", "span", "div", "blockquote", "pre", "code",
      "table", "thead", "tbody", "tr", "th", "td",
      "img", "figure", "figcaption",
      "details", "summary",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "class", "style", "src", "alt", "width", "height"],
    ALLOW_DATA_ATTR: false,
  });

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
