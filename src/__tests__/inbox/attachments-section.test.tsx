import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttachmentsSection } from "@/app/inbox/insight/[id]/_components/AttachmentsSection";

const makeAtt = (id: number, overrides: Partial<{ filename: string; mime_type: string; size_bytes: number }>) => ({
  id,
  attachment_type: "file",
  canonical_entity_id: "inv-42",
  canonical_entity_type: "canonical_invoice",
  created_at: "2026-04-18T00:00:00Z",
  email_id: null,
  filename: overrides.filename ?? `file-${id}.pdf`,
  metadata: null,
  mime_type: overrides.mime_type ?? "application/pdf",
  size_bytes: overrides.size_bytes ?? 102400,
  storage_path: `path/${id}`,
  syntage_file_id: null,
  uploaded_by: null,
});

describe("AttachmentsSection", () => {
  it("renders one row per attachment", () => {
    render(<AttachmentsSection items={[makeAtt(1, {}), makeAtt(2, {})]} />);
    expect(screen.getAllByTestId("attachment-item").length).toBe(2);
  });

  it("shows empty state when no attachments", () => {
    render(<AttachmentsSection items={[]} />);
    expect(screen.getByText(/sin archivos/i)).toBeInTheDocument();
  });

  it("displays formatted file size", () => {
    render(<AttachmentsSection items={[makeAtt(1, { size_bytes: 1024 * 1024 })]} />);
    expect(screen.getByText(/1\.0 MB/i)).toBeInTheDocument();
  });
});
