/**
 * Sanitize email content before sending to Claude API.
 * Prevents prompt injection and reduces token waste.
 */

// Patterns that look like prompt injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /<<SYS>>/i,
  /IMPORTANT:\s*ignore/i,
  /forget\s+(everything|all|your)/i,
];

export function sanitizeEmailForClaude(body: string, maxLength: number = 3000): string {
  if (!body) return "";

  // Strip HTML tags
  let clean = body.replace(/<[^>]*>/g, " ");

  // Normalize whitespace
  clean = clean.replace(/\s+/g, " ").trim();

  // Detect and flag potential prompt injection
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      clean = clean.replace(pattern, "[FILTERED]");
    }
  }

  // Truncate to max length
  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength) + "... [truncado]";
  }

  return clean;
}

/**
 * Sanitize a batch of emails, returning sanitized versions.
 */
export function sanitizeEmailBatch(
  emails: { body?: string; snippet?: string; subject?: string }[]
): typeof emails {
  return emails.map((e) => ({
    ...e,
    body: e.body ? sanitizeEmailForClaude(e.body) : e.body,
    snippet: e.snippet ? sanitizeEmailForClaude(e.snippet, 500) : e.snippet,
    // Subjects are short, just strip HTML
    subject: e.subject ? e.subject.replace(/<[^>]*>/g, "").slice(0, 200) : e.subject,
  }));
}
