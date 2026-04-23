import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import * as React from "react";

// Import from individual files to avoid server-only transitive import via barrel index
// (company-link, evidence-pack, period-selector, invoice-detail all pull in _helpers.ts which
//  imports "server-only" — not available in jsdom. Existing pattern tests use the same approach.)
import { CompanyListClient, type CompanyListRow } from "@/app/empresas/_components/CompanyListClient";
import { PanoramaTab } from "@/app/empresas/[id]/_components/PanoramaTab";
import { AuditoriaSatTab } from "@/app/empresas/[id]/_components/AuditoriaSatTab";
import type {
  CompanyDriftAggregates,
  CompanyDriftRow,
} from "@/lib/queries/canonical/company-drift";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Chart } from "@/components/patterns/chart";
import { TrendSpark } from "@/components/patterns/trend-spark";
import { InboxCard } from "@/components/patterns/inbox-card";
import type { InboxCardIssue } from "@/components/patterns/inbox-card";
import { SwipeStack } from "@/components/patterns/swipe-stack";
import { AgingBuckets } from "@/components/patterns/aging-buckets";
import { CompanyKpiHero } from "@/components/patterns/company-kpi-hero";
import { IssueDetailClient, type IssueDetailItem } from "@/app/inbox/insight/[id]/_components/IssueDetailClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cobranza",
}));
vi.mock("@/app/inbox/actions", () => ({
  addManualNote: vi.fn(async () => ({ ok: true })),
  setInsightState: vi.fn(async () => ({ ok: true })),
  markInsightSeen: vi.fn(async () => {}),
}));

global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;

async function runAxe(node: Element | Document): Promise<axe.AxeResults> {
  return axe.run(node, {
    // jsdom doesn't actually render visually, so skip color-contrast (needs real rendering)
    rules: {
      "color-contrast": { enabled: false },
      "region": { enabled: false },
    },
  });
}

function assertNoCriticalViolations(results: axe.AxeResults): void {
  const critical = results.violations.filter((v) => v.impact === "critical");
  if (critical.length > 0) {
    const msg = critical
      .map((v) => `  [${v.impact}] ${v.id}: ${v.description}`)
      .join("\n");
    throw new Error(`axe-core critical violations:\n${msg}`);
  }
}

describe("axe-core a11y scan — SP6 new/consolidated components", () => {
  it("StatusBadge (all kinds, density=compact + regular)", async () => {
    const { container } = render(
      <div>
        <StatusBadge kind="severity" value="critical" />
        <StatusBadge kind="severity" value="high" density="regular" />
        <StatusBadge kind="payment" value="paid" />
        <StatusBadge kind="payment" value="not_paid" density="regular" />
        <StatusBadge kind="estado_sat" value="cancelado" />
        <StatusBadge kind="blacklist" value="69b_definitivo" />
        <StatusBadge kind="shadow" value={true} />
        <StatusBadge kind="match" value={0.4} />
        <StatusBadge kind="staleness" value="stale" />
      </div>
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("Chart (line, bar, sparkline) with required ariaLabel", async () => {
    const { container } = render(
      <div>
        <Chart
          type="line"
          data={[{ x: 1, y: 10 }, { x: 2, y: 20 }]}
          xKey="x"
          series={[{ key: "y", label: "Series A" }]}
          ariaLabel="Line chart demo"
        />
        <Chart
          type="bar"
          data={[{ m: "Ene", v: 50 }, { m: "Feb", v: 75 }]}
          xKey="m"
          series={[{ key: "v", label: "Bar" }]}
          ariaLabel="Bar chart demo"
        />
        <Chart
          type="sparkline"
          data={[{ i: 0, v: 10 }, { i: 1, v: 20 }, { i: 2, v: 15 }]}
          xKey="i"
          series={[{ key: "v", label: "spark" }]}
          ariaLabel="Sparkline demo"
        />
      </div>
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("TrendSpark (up/down/flat)", async () => {
    const { container } = render(
      <div>
        <TrendSpark values={[1, 2, 3, 4]} ariaLabel="Up" />
        <TrendSpark values={[4, 3, 2, 1]} ariaLabel="Down" />
        <TrendSpark values={[2, 2, 2]} ariaLabel="Flat" />
      </div>
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("InboxCard (with and without assignee/action)", async () => {
    const issue: InboxCardIssue = {
      issue_id: "abc-1",
      issue_type: "invoice.posted_without_uuid",
      severity: "critical",
      priority_score: 87,
      impact_mxn: 125000,
      age_days: 4,
      description: "Factura sin UUID timbrado",
      canonical_entity_type: "canonical_invoice",
      canonical_entity_id: "inv-42",
      action_cta: "operationalize",
      assignee: { id: 5, name: "Sandra Davila", email: "s@quimibond.com" },
      detected_at: "2026-04-18T09:00:00Z",
    };
    const noAssignee: InboxCardIssue = { ...issue, assignee: null };
    const noAction: InboxCardIssue = { ...issue, action_cta: null };
    const { container } = render(
      <div>
        <InboxCard issue={issue} onAction={() => {}} />
        <InboxCard issue={noAssignee} onAction={() => {}} />
        <InboxCard issue={noAction} />
      </div>
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("SwipeStack with multiple children", async () => {
    const { container } = render(
      <SwipeStack ariaLabel="Demo stack">
        <div>Item one</div>
        <div>Item two</div>
        <div>Item three</div>
      </SwipeStack>
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("AgingBuckets with click-to-filter", async () => {
    const { container } = render(
      <AgingBuckets
        data={{ current: 500000, d1_30: 150000, d31_60: 80000, d61_90: 40000, d90_plus: 25000 }}
        ariaLabel="Aging de cartera"
        onBucketClick={() => {}}
      />
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("CompanyKpiHero (default + blacklist + shadow)", async () => {
    const canonical = {
      id: 123,
      display_name: "ACME S.A. DE C.V.",
      rfc: "AAA010101AAA",
      has_shadow_flag: false,
      blacklist_level: "none" as const,
    };
    const company360 = {
      canonical_company_id: 123,
      lifetime_value_mxn: 12500000,
      revenue_ytd_mxn: 3200000,
      overdue_amount_mxn: 180000,
      open_company_issues_count: 3,
      revenue_90d_mxn: 520000,
    };
    const { container } = render(
      <div>
        <CompanyKpiHero canonical={canonical} company360={company360} trend={[100, 150, 180]} />
        <CompanyKpiHero canonical={{ ...canonical, blacklist_level: "69b_definitivo" }} company360={company360} />
        <CompanyKpiHero canonical={{ ...canonical, has_shadow_flag: true }} company360={company360} />
      </div>
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("IssueDetailClient (full detail view)", async () => {
    const item: IssueDetailItem = {
      issue_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      issue_type: "invoice.posted_without_uuid",
      severity: "critical",
      priority_score: 87,
      impact_mxn: 125000,
      age_days: 4,
      description: "Factura sin UUID timbrado",
      canonical_entity_type: "canonical_invoice",
      canonical_entity_id: "inv-42",
      action_cta: "operationalize",
      assignee_canonical_contact_id: 5,
      assignee_name: "Sandra Davila",
      assignee_email: "sandra@quimibond.com",
      detected_at: "2026-04-18T09:00:00Z",
      invariant_key: null,
      metadata: null,
      email_signals: [],
      ai_extracted_facts: [],
      manual_notes: [],
      attachments: [],
    };
    const { container } = render(<IssueDetailClient item={item} />);
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("CompanyListClient (populated)", async () => {
    const rows: CompanyListRow[] = [
      {
        canonical_company_id: 1,
        display_name: "Empresa Normal",
        rfc: "AAA010101AAA",
        is_customer: true,
        is_supplier: false,
        has_shadow_flag: false,
        blacklist_level: "none",
        lifetime_value_mxn: 1_000_000,
        revenue_ytd_mxn: 250_000,
        overdue_amount_mxn: 0,
        open_company_issues_count: 0,
      },
      {
        canonical_company_id: 2,
        display_name: "Empresa Blacklist",
        rfc: "BBB010101BBB",
        is_customer: true,
        is_supplier: false,
        has_shadow_flag: false,
        blacklist_level: "69b_definitivo",
        lifetime_value_mxn: 2_000_000,
        revenue_ytd_mxn: 500_000,
        overdue_amount_mxn: 340_000,
        open_company_issues_count: 5,
      },
      {
        canonical_company_id: 3,
        display_name: "Empresa Shadow",
        rfc: "CCC010101CCC",
        is_customer: false,
        is_supplier: true,
        has_shadow_flag: true,
        blacklist_level: "none",
        lifetime_value_mxn: 0,
        revenue_ytd_mxn: 0,
        overdue_amount_mxn: 0,
        open_company_issues_count: 0,
      },
    ];
    const { container } = render(
      <CompanyListClient items={rows} hasFilters={false} />
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("AuditoriaSatTab (empty + populated AR + populated AP + category flags)", async () => {
    const emptyAgg: CompanyDriftAggregates = {
      canonical_company_id: 1448,
      display_name: "Contitech",
      rfc: "CON010101XXX",
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
    };
    const arAgg: CompanyDriftAggregates = {
      ...emptyAgg,
      canonical_company_id: 918,
      display_name: "ENTRETELAS BRINCO",
      drift_sat_only_count: 43,
      drift_sat_only_mxn: 24_500_000,
      drift_total_abs_mxn: 24_500_000,
      drift_needs_review: true,
    };
    const apFlaggedAgg: CompanyDriftAggregates = {
      ...emptyAgg,
      canonical_company_id: 1689,
      display_name: "ICOMATEX",
      drift_ap_odoo_only_count: 2,
      drift_ap_odoo_only_mxn: 10_800_000,
      drift_ap_total_abs_mxn: 10_800_000,
      drift_ap_needs_review: true,
      is_foreign: true,
    };
    const arRow: CompanyDriftRow = {
      side: "customer",
      canonical_company_id: 918,
      display_name: "ENTRETELAS BRINCO",
      canonical_id: 101,
      drift_kind: "sat_only",
      invoice_date: "2025-03-15",
      sat_uuid: "11111111-2222-3333-4444-555555555555",
      odoo_invoice_id: null,
      odoo_name: null,
      sat_mxn: 120_000,
      odoo_mxn: null,
      diff_mxn: 120_000,
    };
    const apRow: CompanyDriftRow = {
      side: "supplier",
      canonical_company_id: 1689,
      display_name: "ICOMATEX",
      canonical_id: 202,
      drift_kind: "odoo_only",
      invoice_date: "2025-06-01",
      sat_uuid: null,
      odoo_invoice_id: 5001,
      odoo_name: "INV/2025/06/0001",
      sat_mxn: null,
      odoo_mxn: 5_400_000,
      diff_mxn: -5_400_000,
    };
    const { container } = render(
      <div>
        <AuditoriaSatTab aggregates={emptyAgg} rows={[]} />
        <AuditoriaSatTab aggregates={arAgg} rows={[arRow]} />
        <AuditoriaSatTab aggregates={apFlaggedAgg} rows={[apRow]} />
      </div>,
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("PanoramaTab (fully populated)", async () => {
    const detail = {
      aging: { current: 500_000, d1_30: 100_000, d31_60: 40_000, d61_90: 10_000, d90_plus: 5_000 },
      revenueTrend: [
        { month_start: "2025-06-01", total_mxn: 100_000 },
        { month_start: "2025-07-01", total_mxn: 120_000 },
      ],
      recentSaleOrders: [
        { canonical_id: "so-1", name: "SO/2026/0123", amount_total_mxn: 45_000, date_order: "2026-04-10" },
      ],
      recentEvidence: [
        { kind: "email" as const, key: "e1", title: "past_due_mention", body: "pago vencido", at: "2026-04-18T00:00:00Z" },
      ],
    };
    const { container } = render(<PanoramaTab detail={detail} />);
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("AgingSection (clickable buckets) — 0 critical violations", async () => {
    const { AgingSection } = await import("@/app/cobranza/_components/AgingSection");
    const { container } = render(
      <AgingSection
        data={{
          current: 100,
          d1_30: 200,
          d31_60: 300,
          d61_90: 400,
          d90_plus: 500,
        }}
      />
    );
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
  });

  it("OverdueSection (populated, with filter bar + invoice list) — 0 critical violations", async () => {
    vi.doMock("@/lib/queries/unified/invoices", () => ({
      getOverdueInvoicesPage: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            name: "INV/2026/03/0001",
            company_id: 101,
            company_name: "Acme SA",
            amount_total_mxn: 50_000,
            amount_residual_mxn: 50_000,
            currency: "MXN",
            days_overdue: 30,
            due_date: "2026-03-22",
            invoice_date: "2026-02-22",
            payment_state: "not_paid",
            salesperson_name: null,
            uuid_sat: null,
            estado_sat: null,
          },
        ],
        total: 1,
      }),
      getOverdueSalespeopleOptions: vi.fn().mockResolvedValue(["Sandra Davila"]),
    }));
    vi.doMock("@/lib/queries/_shared/_helpers", () => ({
      sanitizeCompanyName: (name: string | null | undefined) => name ?? null,
      joinedCompanyName: (companies: unknown) => null,
    }));
    vi.resetModules();
    const { OverdueSection } = await import("@/app/cobranza/_components/OverdueSection");
    const ui = await OverdueSection({
      params: {
        aging: "31-60",
        q: "",
        salesperson: undefined,
        page: 1,
        limit: 50,
      },
    });
    const { container } = render(ui);
    const results = await runAxe(container);
    assertNoCriticalViolations(results);
    vi.doUnmock("@/lib/queries/unified/invoices");
    vi.doUnmock("@/lib/queries/_shared/_helpers");
  });
});
