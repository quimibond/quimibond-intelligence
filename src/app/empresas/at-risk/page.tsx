import { redirect } from "next/navigation";

/**
 * Antes era una página standalone con RFM segmentation.
 * Ahora vive como sección "Reactivación" dentro de /companies.
 */
export default function AtRiskRedirect() {
  redirect("/companies#reactivacion");
}
