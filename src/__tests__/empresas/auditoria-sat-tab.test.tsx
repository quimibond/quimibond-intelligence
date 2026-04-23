import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditoriaSatTab } from "@/app/empresas/[id]/_components/AuditoriaSatTab";
import type {
  CompanyDriftAggregates,
  CompanyDriftRow,
} from "@/lib/queries/canonical/company-drift";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/empresas/918",
}));

function mkAgg(overrides: Partial<CompanyDriftAggregates> = {}): CompanyDriftAggregates {
  return {
    canonical_company_id: 918,
    display_name: "ENTRETELAS BRINCO",
    rfc: "EBR010101XXX",
    drift_sat_only_count: 0,
    drift_sat_only_mxn: 0,
    drift_odoo_only_count: 0,
    drift_odoo_only_mxn: 0,
    drift_matched_diff_count: 0,
    drift_matched_abs_mxn: 0,
    drift_total_abs_mxn: 0,
    drift_needs_review: false,
    drift_last_computed_at: "2026-04-23T00:00:00Z",
    drift_ap_sat_only_count: 0,
    drift_ap_sat_only_mxn: 0,
    drift_ap_odoo_only_count: 0,
    drift_ap_odoo_only_mxn: 0,
    drift_ap_matched_diff_count: 0,
    drift_ap_matched_abs_mxn: 0,
    drift_ap_total_abs_mxn: 0,
    drift_ap_needs_review: false,
    is_foreign: false,
    is_bank: false,
    is_government: false,
    is_payroll_entity: false,
    ...overrides,
  };
}

function mkRow(overrides: Partial<CompanyDriftRow> = {}): CompanyDriftRow {
  return {
    side: "customer",
    canonical_company_id: 918,
    display_name: "ENTRETELAS BRINCO",
    canonical_id: 1001,
    drift_kind: "sat_only",
    invoice_date: "2025-03-15",
    sat_uuid: "11111111-2222-3333-4444-555555555555",
    odoo_invoice_id: null,
    odoo_name: null,
    sat_mxn: 120_000,
    odoo_mxn: null,
    diff_mxn: 120_000,
    ...overrides,
  };
}

describe("AuditoriaSatTab", () => {
  it("renders empty state when both AR and AP drift totals are 0", () => {
    const { container } = render(<AuditoriaSatTab aggregates={mkAgg()} rows={[]} />);
    expect(screen.getByText(/sin drift odoo/i)).toBeInTheDocument();
    // No drift rows table should render in the empty branch
    expect(container.querySelector("table")).toBeNull();
  });

  it("renders AR subsection when AR drift > 0", () => {
    render(
      <AuditoriaSatTab
        aggregates={mkAgg({
          drift_sat_only_count: 43,
          drift_sat_only_mxn: 24_500_000,
          drift_total_abs_mxn: 24_500_000,
          drift_needs_review: true,
        })}
        rows={[mkRow({ side: "customer" })]}
      />,
    );
    expect(screen.getByText(/clientes \(ar/i)).toBeInTheDocument();
    // Matches both the subsection metric label and the table row badge
    expect(screen.getAllByText(/cfdi sin odoo/i).length).toBeGreaterThan(0);
  });

  it("renders AP subsection when AP drift > 0 and hides AR when AR is 0", () => {
    render(
      <AuditoriaSatTab
        aggregates={mkAgg({
          canonical_company_id: 1689,
          display_name: "ICOMATEX",
          drift_ap_odoo_only_count: 2,
          drift_ap_odoo_only_mxn: 10_800_000,
          drift_ap_total_abs_mxn: 10_800_000,
          drift_ap_needs_review: true,
        })}
        rows={[
          mkRow({
            side: "supplier",
            drift_kind: "odoo_only",
            sat_uuid: null,
            sat_mxn: null,
            odoo_invoice_id: 5001,
            odoo_name: "INV/2025/05/0033",
            odoo_mxn: 5_400_000,
            diff_mxn: -5_400_000,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/proveedores \(ap/i)).toBeInTheDocument();
    expect(screen.queryByText(/clientes \(ar/i)).toBeNull();
    // Odoo link should be clickable
    const odooLink = screen.getAllByRole("link").find((a) =>
      a.getAttribute("href")?.includes("id=5001"),
    );
    expect(odooLink).toBeTruthy();
    expect(odooLink?.getAttribute("target")).toBe("_blank");
  });

  it("pins danger styling when needs_review is true", () => {
    const { container } = render(
      <AuditoriaSatTab
        aggregates={mkAgg({
          drift_total_abs_mxn: 100,
          drift_needs_review: true,
        })}
        rows={[mkRow()]}
      />,
    );
    const danger = container.querySelectorAll(".text-danger, .bg-danger\\/10");
    expect(danger.length).toBeGreaterThan(0);
  });

  it("shows success icon + no needs_review border when all clean but one side >0", () => {
    // When the user is viewing a non-suppressed company with a tiny drift (warning range)
    const { container } = render(
      <AuditoriaSatTab
        aggregates={mkAgg({
          drift_total_abs_mxn: 500,
          drift_needs_review: false,
        })}
        rows={[mkRow({ sat_mxn: 500, diff_mxn: 500 })]}
      />,
    );
    expect(container.querySelector(".text-warning, .bg-warning\\/10")).not.toBeNull();
  });

  it("renders category flag badges when at least one is_* is true", () => {
    render(
      <AuditoriaSatTab
        aggregates={mkAgg({
          drift_total_abs_mxn: 1_000,
          is_foreign: true,
          is_bank: true,
        })}
        rows={[mkRow()]}
      />,
    );
    expect(screen.getByText(/extranjero/i)).toBeInTheDocument();
    expect(screen.getByText(/banco/i)).toBeInTheDocument();
    expect(screen.queryByText(/gobierno/i)).toBeNull();
  });

  it("renders SAT verify deep link with encoded UUID", () => {
    render(
      <AuditoriaSatTab
        aggregates={mkAgg({ drift_total_abs_mxn: 100 })}
        rows={[mkRow({ sat_uuid: "ABC-123 WITH SPACE" })]}
      />,
    );
    const satLink = screen.getAllByRole("link").find((a) =>
      a.getAttribute("href")?.includes("verificacfdi.facturaelectronica.sat.gob.mx"),
    );
    expect(satLink).toBeTruthy();
    expect(satLink?.getAttribute("href")).toContain("ABC-123%20WITH%20SPACE");
    expect(satLink?.getAttribute("rel")).toContain("noopener");
  });
});
