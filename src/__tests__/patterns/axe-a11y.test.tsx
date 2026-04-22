import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import axe from "axe-core";
import * as React from "react";

// Import from individual files to avoid server-only transitive import via barrel index
// (company-link, evidence-pack, period-selector, invoice-detail all pull in _helpers.ts which
//  imports "server-only" — not available in jsdom. Existing pattern tests use the same approach.)
import { StatusBadge } from "@/components/patterns/status-badge";
import { Chart } from "@/components/patterns/chart";
import { TrendSpark } from "@/components/patterns/trend-spark";
import { InboxCard } from "@/components/patterns/inbox-card";
import type { InboxCardIssue } from "@/components/patterns/inbox-card";
import { SwipeStack } from "@/components/patterns/swipe-stack";
import { AgingBuckets } from "@/components/patterns/aging-buckets";
import { CompanyKpiHero } from "@/components/patterns/company-kpi-hero";

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
});
