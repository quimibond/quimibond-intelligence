import { redirect } from "next/navigation";

/**
 * Antes era una página standalone con variancia cross-proveedor.
 * Ahora vive como sección "Variancia vs mercado" dentro de /compras.
 */
export default function PriceVarianceRedirect() {
  redirect("/compras#variance-market");
}
