import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAccountExpenseDetail } from "@/lib/queries/sp13/finanzas/account-expense-detail";
import { getAccountNarrative } from "@/lib/queries/sp13/finanzas/account-expense-narrative";
import { AccountHeader } from "./_components/account-header";
import { AccountNarrativeBlock } from "./_components/account-narrative-block";
import { AccountTrend } from "./_components/account-trend";
import { VendorBreakdownTable } from "./_components/vendor-breakdown-table";
import { InvoiceLinesTable } from "./_components/invoice-lines-table";
import { Skeleton } from "@/components/ui/skeleton";

const ACCOUNT_RE = /^[\d.]+$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function defaultPeriod(): string {
  const t = new Date();
  const prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  if (!ACCOUNT_RE.test(code)) notFound();

  const sp = await searchParams;
  const fromRaw = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const toRaw = Array.isArray(sp.to) ? sp.to[0] : sp.to;
  const fromPeriod =
    fromRaw && PERIOD_RE.test(fromRaw) ? fromRaw : defaultPeriod();
  const toPeriod = toRaw && PERIOD_RE.test(toRaw) ? toRaw : fromPeriod;

  const detail = await getAccountExpenseDetail(code, fromPeriod, toPeriod);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <Link
        href="/contabilidad?tab=estado#pnl-by-account"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Volver a Gastos por cuenta
      </Link>

      <AccountHeader detail={detail} />

      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <NarrativeBlock detail={detail} />
      </Suspense>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Trend mensual (últimos 12 meses)
        </h2>
        <AccountTrend detail={detail} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Proveedores en el período
        </h2>
        <VendorBreakdownTable
          vendors={detail.vendors}
          totalMxn={detail.totalMxn}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Detalle de líneas (top 100 por monto)
        </h2>
        <InvoiceLinesTable lines={detail.recentLines} />
      </section>
    </main>
  );
}

async function NarrativeBlock({
  detail,
}: {
  detail: Awaited<ReturnType<typeof getAccountExpenseDetail>>;
}) {
  const narrative = await getAccountNarrative(detail);
  if (!narrative) return null;
  return <AccountNarrativeBlock narrative={narrative} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return { title: `Cuenta ${code} — Quimibond` };
}
