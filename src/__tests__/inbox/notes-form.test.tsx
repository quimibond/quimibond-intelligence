import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotesSection } from "@/app/inbox/insight/[id]/_components/NotesSection";

const addNoteMock = vi.fn(async (_: unknown) => ({ ok: true }));
vi.mock("@/app/inbox/actions", () => ({
  addManualNote: (...args: unknown[]) => addNoteMock(args[0]),
}));

const makeNote = (id: number, body: string) => ({
  id,
  body,
  canonical_entity_id: "inv-42",
  canonical_entity_type: "canonical_invoice",
  created_at: "2026-04-18T00:00:00Z",
  created_by: "ceo",
  note_type: "inbox_detail",
  pinned: false,
  updated_at: "2026-04-18T00:00:00Z",
});

describe("NotesSection", () => {
  it("renders existing notes ordered by created_at desc", () => {
    render(
      <NotesSection
        notes={[makeNote(1, "Primera nota"), makeNote(2, "Segunda nota")]}
        canonicalEntityType="canonical_invoice"
        canonicalEntityId="inv-42"
      />
    );
    expect(screen.getByText(/primera nota/i)).toBeInTheDocument();
    expect(screen.getByText(/segunda nota/i)).toBeInTheDocument();
  });

  it("submits a new note via server action", async () => {
    addNoteMock.mockClear();
    render(
      <NotesSection
        notes={[]}
        canonicalEntityType="canonical_invoice"
        canonicalEntityId="inv-42"
      />
    );
    const textarea = screen.getByPlaceholderText(/agregar nota/i);
    fireEvent.change(textarea, { target: { value: "Una nueva nota" } });
    fireEvent.click(screen.getByRole("button", { name: /agregar/i }));
    await waitFor(() =>
      expect(addNoteMock).toHaveBeenCalledWith({
        canonical_entity_type: "canonical_invoice",
        canonical_entity_id: "inv-42",
        body: "Una nueva nota",
      })
    );
  });

  it("shows error when body is empty on submit", async () => {
    render(
      <NotesSection
        notes={[]}
        canonicalEntityType="canonical_invoice"
        canonicalEntityId="inv-42"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /agregar/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
