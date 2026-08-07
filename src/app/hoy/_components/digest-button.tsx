"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function DigestButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline/email-digest?manual=1", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      console.error("[digest] generate failed", err);
      alert("No se pudo generar el resumen. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={generate}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
    >
      <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Generando… (~20s)" : "Generar ahora"}
    </button>
  );
}
