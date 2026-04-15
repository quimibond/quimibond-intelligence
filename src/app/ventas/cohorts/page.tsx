import { redirect } from "next/navigation";

/**
 * Antes era una página standalone con heatmap de retención.
 * Ahora vive como sección "Retención" dentro de /ventas.
 */
export default function CohortsRedirect() {
  redirect("/ventas#retention");
}
