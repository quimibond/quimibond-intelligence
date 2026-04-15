import { redirect } from "next/navigation";

/**
 * Antes era una página standalone con la cola de stockouts.
 * Ahora vive como sección "Cola de reposición" dentro de /compras.
 */
export default function StockoutsRedirect() {
  redirect("/compras#stockouts");
}
