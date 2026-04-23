import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanoramaTab } from "@/app/empresas/[id]/_components/PanoramaTab";

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 868,
    canonical_company_id: 868,
    name: "ACME S.A. DE C.V.",
    display_name: "ACME S.A. DE C.V.",
    rfc: "AAA010101AAA",
    has_shadow_flag: false,
    blacklist_level: "none" as const,
    aging: {
      current: 500_000,
      d1_30: 100_000,
      d31_60: 40_000,
      d61_90: 10_000,
      d90_plus: 5_000,
    },
    revenueTrend: [
      { month_start: "2025-06-01", total_mxn: 100_000 },
      { month_start: "2025-07-01", total_mxn: 120_000 },
      { month_start: "2025-08-01", total_mxn: 150_000 },
    ],
    recentSaleOrders: [
      { canonical_id: "so-1", name: "SO/2026/0123", amount_total_mxn: 45_000, date_order: "2026-04-10" },
      { canonical_id: "so-2", name: "SO/2026/0119", amount_total_mxn: 18_000, date_order: "2026-04-08" },
    ],
    recentEvidence: [
      { kind: "email" as const, key: "e1", title: "past_due_mention", body: "pago vencido", at: "2026-04-18T00:00:00Z" },
    ],
    ...overrides,
  };
}

describe("PanoramaTab", () => {
  it("renders Cartera abierta section with AgingBuckets when aging totals > 0", () => {
    render(<PanoramaTab detail={makeDetail()} />);
    expect(screen.getByText(/cartera abierta/i)).toBeInTheDocument();
  });

  it("renders Revenue 12 meses section with chart role=img", () => {
    const { container } = render(<PanoramaTab detail={makeDetail()} />);
    expect(screen.getByText(/revenue 12 meses/i)).toBeInTheDocument();
    expect(container.querySelector('[role="img"]')).toBeTruthy();
  });

  it("renders Pedidos recientes section with order names", () => {
    render(<PanoramaTab detail={makeDetail()} />);
    expect(screen.getByText(/pedidos recientes/i)).toBeInTheDocument();
    expect(screen.getByText(/SO\/2026\/0123/)).toBeInTheDocument();
  });

  it("renders Actividad reciente section with evidence items", () => {
    render(<PanoramaTab detail={makeDetail()} />);
    expect(screen.getByText(/actividad reciente/i)).toBeInTheDocument();
    expect(screen.getByText(/past_due_mention/)).toBeInTheDocument();
  });

  it("hides Cartera section when all aging buckets are zero", () => {
    const detail = makeDetail({
      aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
    });
    render(<PanoramaTab detail={detail} />);
    expect(screen.queryByText(/cartera abierta/i)).toBeNull();
  });
});
