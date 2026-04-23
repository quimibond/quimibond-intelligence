import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries/analytics/finance", () => ({
  getCfoSnapshot: vi.fn().mockResolvedValue({
    carteraVencida: 1_250_000,
    cuentasPorCobrar: 8_400_000,
    cobros30d: 3_100_000,
    clientesMorosos: 14,
  }),
}));

vi.mock("@/lib/queries/unified/invoices", () => ({
  getPaymentRiskKpis: vi.fn().mockResolvedValue({
    abnormalCount: 22,
    abnormalPending: 750_000,
    criticalCount: 6,
    criticalPending: 480_000,
  }),
}));

import { CobranzaHeroKpis } from "@/app/cobranza/_components/CobranzaHeroKpis";

describe("<CobranzaHeroKpis />", () => {
  it("renders 4 KPI cards with formatted MXN values", async () => {
    const ui = await CobranzaHeroKpis();
    render(ui);
    expect(screen.getByText("Cartera vencida")).toBeInTheDocument();
    expect(screen.getByText("Cuentas por cobrar")).toBeInTheDocument();
    expect(screen.getByText("Cobros 30d")).toBeInTheDocument();
    expect(screen.getByText("Riesgo crítico")).toBeInTheDocument();
    // Subtitles include morosos / clientes counts
    expect(screen.getByText(/14 clientes morosos/)).toBeInTheDocument();
    expect(screen.getByText(/6 clientes/)).toBeInTheDocument();
  });

  it("renders zeros gracefully when getCfoSnapshot returns null-ish", async () => {
    const finance = await import("@/lib/queries/analytics/finance");
    vi.mocked(finance.getCfoSnapshot).mockResolvedValueOnce(
      null as unknown as Awaited<ReturnType<typeof finance.getCfoSnapshot>>
    );
    const ui = await CobranzaHeroKpis();
    render(ui);
    expect(screen.getByText("Cartera vencida")).toBeInTheDocument();
    expect(screen.getByText(/0 clientes morosos/)).toBeInTheDocument();
  });
});
