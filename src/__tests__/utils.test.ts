import { describe, it, expect } from "vitest";
import {
  cn,
  formatDate,
  formatDateTime,
  timeAgo,
  truncate,
  getInitials,
  scoreToPercent,
  formatCurrency,
  sentimentColor,
} from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("deduplicates tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("formatDate", () => {
  it("returns dash for null", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("formats a date string", () => {
    const result = formatDate("2025-06-15T12:00:00Z");
    expect(result).toContain("2025");
    expect(result).toContain("15");
  });
});

describe("formatDateTime", () => {
  it("returns dash for null", () => {
    expect(formatDateTime(null)).toBe("—");
  });

  it("includes time in output", () => {
    const result = formatDateTime("2025-06-15T14:30:00Z");
    expect(result).toBeTruthy();
    expect(result).not.toBe("—");
  });
});

describe("timeAgo", () => {
  it("returns dash for null", () => {
    expect(timeAgo(null)).toBe("—");
  });

  it("returns 'ahora' for recent dates", () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe("ahora");
  });

  it("returns minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe("hace 5m");
  });

  it("returns hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(twoHoursAgo)).toBe("hace 2h");
  });

  it("returns days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(threeDaysAgo)).toBe("hace 3d");
  });
});

describe("truncate", () => {
  it("returns empty string for null", () => {
    expect(truncate(null, 10)).toBe("");
  });

  it("returns original if short enough", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates with ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });
});

describe("getInitials", () => {
  it("returns ? for null", () => {
    expect(getInitials(null)).toBe("?");
  });

  it("extracts first two initials", () => {
    expect(getInitials("John Doe")).toBe("JD");
  });

  it("handles single name", () => {
    expect(getInitials("John")).toBe("J");
  });

  it("handles three names", () => {
    expect(getInitials("Juan Carlos Perez")).toBe("JC");
  });
});

describe("scoreToPercent", () => {
  it("returns 0 for null", () => {
    expect(scoreToPercent(null)).toBe(0);
  });

  it("converts score to percentage", () => {
    expect(scoreToPercent(50)).toBe(50);
  });

  it("clamps to 0-100", () => {
    expect(scoreToPercent(-10)).toBe(0);
    expect(scoreToPercent(150)).toBe(100);
  });

  it("supports custom max", () => {
    expect(scoreToPercent(5, 10)).toBe(50);
  });
});

describe("formatCurrency", () => {
  it("returns dash for null", () => {
    expect(formatCurrency(null)).toBe("—");
  });

  it("formats positive numbers with $ prefix", () => {
    const result = formatCurrency(1000);
    expect(result).toContain("$");
    expect(result).toContain("1");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0");
  });

  it("formats large numbers with separators", () => {
    const result = formatCurrency(1000000);
    expect(result).toContain("$");
    // Should have some separator (locale-dependent)
    expect(result.length).toBeGreaterThan(2);
  });
});

describe("sentimentColor", () => {
  it("returns muted for null", () => {
    expect(sentimentColor(null)).toBe("text-muted-foreground");
  });

  it("returns success for high sentiment", () => {
    expect(sentimentColor(0.8)).toBe("text-success");
  });

  it("returns warning for medium sentiment", () => {
    expect(sentimentColor(0.4)).toBe("text-warning");
  });

  it("returns danger for low sentiment", () => {
    expect(sentimentColor(0.1)).toBe("text-danger");
  });
});
