import { QuestionSection } from "@/components/patterns";
import { formatCurrencyMXN } from "@/lib/formatters";
import { getBankDetail } from "@/lib/queries/sp13/finanzas";
import { BankDetailExpand } from "../bank-detail-expand";

export async function BankDetailBlock() {
  const accounts = await getBankDetail();
  const total = accounts.reduce(
    (s, a) => s + (a.classification === "cash" ? a.currentBalanceMxn : 0),
    0
  );
  return (
    <QuestionSection
      id="bank-detail"
      question="¿Qué hay en cada cuenta bancaria?"
      subtext={`${accounts.length} cuentas · ${formatCurrencyMXN(total, { compact: true })} en efectivo`}
      collapsible
      defaultOpen={false}
    >
      <BankDetailExpand accounts={accounts} />
    </QuestionSection>
  );
}
