"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function AlertsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/inbox"); }, [router]);
  return <div className="flex items-center justify-center h-[50vh] text-muted-foreground">Redirigiendo al inbox...</div>;
}
