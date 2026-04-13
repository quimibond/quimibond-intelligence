"use client";

import { useEffect, useState } from "react";

/** Breakpoint sm en Tailwind (640px). */
const MOBILE_BREAKPOINT = 640;

/**
 * useMobile — true cuando el viewport es mobile (<640px).
 * SSR-safe: retorna false en el primer render.
 */
export function useMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}
