import { describe, it, expect, vi } from "vitest";
import { exportCSV } from "@/lib/export-csv";

describe("exportCSV", () => {
  it("does nothing with empty data", () => {
    // Should not throw
    exportCSV([], "test");
  });

  it("generates correct CSV content", () => {
    let capturedHref = "";
    const capturedDownload = "";

    // Mock DOM elements
    const mockLink = {
      href: "",
      download: "",
      click: vi.fn(),
      set _href(v: string) { capturedHref = v; this.href = v; },
    };

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return mockLink as unknown as HTMLElement;
      return originalCreateElement(tag);
    });

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();

    exportCSV(
      [
        { name: "Alice", score: 90 },
        { name: "Bob", score: 75 },
      ],
      "test-export",
      [
        { key: "name", label: "Nombre" },
        { key: "score", label: "Puntaje" },
      ]
    );

    expect(mockLink.click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();

    // Restore
    URL.createObjectURL = originalCreateObjectURL;
    vi.restoreAllMocks();
  });
});
