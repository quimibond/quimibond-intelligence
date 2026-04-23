import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceSection } from "@/app/inbox/insight/[id]/_components/EvidenceSection";

const baseSignal = {
  id: 1,
  canonical_entity_id: "inv-42",
  canonical_entity_type: "canonical_invoice",
  email_id: 10,
  signal_type: "past_due_mention",
  signal_value: "mentioned overdue invoice",
  confidence: 0.8,
  thread_id: null,
  extracted_at: "2026-04-18T09:00:00Z",
  expires_at: null,
};

const baseFact = {
  id: 1,
  canonical_entity_id: "inv-42",
  canonical_entity_type: "canonical_invoice",
  fact_type: "promised_payment_date",
  fact_text: "cliente promete pagar 2026-04-25",
  extracted_at: "2026-04-19T09:00:00Z",
  confidence: 0.9,
  created_at: "2026-04-19T09:00:00Z",
  expired: false,
  extraction_run_id: null,
  fact_date: null,
  fact_hash: null,
  is_future: false,
  legacy_facts_id: null,
  source_account: null,
  source_ref: null,
  source_type: "ai_extracted",
  superseded_by: null,
  verification_source: null,
  verified: false,
  verified_at: null,
};

describe("EvidenceSection", () => {
  it("merges signals and facts sorted by extracted_at desc", () => {
    render(<EvidenceSection signals={[baseSignal]} facts={[baseFact]} />);
    const items = screen.getAllByTestId("evidence-item");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("promised_payment_date");
    expect(items[1].textContent).toContain("past_due_mention");
  });

  it("caps visible items to 25 and shows 'Ver más' when more exist", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...baseSignal,
      id: i + 10,
      signal_type: `signal_${i}`,
      extracted_at: `2026-04-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    }));
    render(<EvidenceSection signals={many} facts={[]} />);
    expect(screen.getAllByTestId("evidence-item").length).toBe(25);
    expect(screen.getByRole("button", { name: /ver más/i })).toBeInTheDocument();
  });

  it("clicking 'Ver más' expands the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...baseSignal,
      id: i + 10,
      signal_type: `signal_${i}`,
      extracted_at: `2026-04-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    }));
    render(<EvidenceSection signals={many} facts={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /ver más/i }));
    expect(screen.getAllByTestId("evidence-item").length).toBe(30);
  });

  it("renders empty state when no signals and no facts", () => {
    render(<EvidenceSection signals={[]} facts={[]} />);
    expect(screen.getByText(/sin evidencia/i)).toBeInTheDocument();
  });
});
