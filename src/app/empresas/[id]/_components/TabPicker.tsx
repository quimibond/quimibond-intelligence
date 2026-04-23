"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toSearchString } from "@/lib/url-state";

export type TabKey =
  | "panorama"
  | "comercial"
  | "financiero"
  | "operativo"
  | "fiscal"
  | "pagos";

const TAB_ORDER: TabKey[] = [
  "panorama",
  "comercial",
  "financiero",
  "operativo",
  "fiscal",
  "pagos",
];

const TAB_LABELS: Record<TabKey, string> = {
  panorama: "Panorama",
  comercial: "Comercial",
  financiero: "Financiero",
  operativo: "Operativo",
  fiscal: "Fiscal",
  pagos: "Pagos",
};

interface Props {
  activeTab: TabKey;
}

export function TabPicker({ activeTab }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const goto = (tab: TabKey) => {
    const qs = toSearchString(
      { tab },
      { dropEqual: { tab: "panorama" } }
    );
    router.push(`${pathname}${qs}`);
  };

  return (
    <div>
      {/* Mobile: Select picker */}
      <div className="md:hidden">
        <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          Vista
        </label>
        <Select value={activeTab} onValueChange={(v) => goto(v as TabKey)}>
          <SelectTrigger className="h-10 w-full" aria-label="Seleccionar vista">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAB_ORDER.map((k) => (
              <SelectItem key={k} value={k}>
                {TAB_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: horizontal tabs */}
      <div className="hidden md:block">
        <Tabs value={activeTab} onValueChange={(v) => goto(v as TabKey)}>
          <TabsList>
            {TAB_ORDER.map((k) => (
              <TabsTrigger key={k} value={k} onClick={() => goto(k)}>
                {TAB_LABELS[k]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
