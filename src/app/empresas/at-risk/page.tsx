import { redirect } from "next/navigation";

/**
 * Legacy redirect. The at-risk RFM section used to live at /empresas/at-risk.
 * Post-sp6-02: RFM reactivation deferred to sp6-02.1; this stub simply sends
 * users back to the portfolio list.
 */
export default function AtRiskRedirect() {
  redirect("/empresas");
}
