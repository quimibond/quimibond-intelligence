"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Hook to sync filter state with URL query parameters.
 * Reads initial values from URL, and provides a setter that updates both state and URL.
 */
export function useQueryFilters<T extends Record<string, string>>(
  defaults: T
): [T, (key: keyof T, value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const values = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const param = searchParams.get(key);
      if (param !== null) {
        (result as Record<string, string>)[key] = param;
      }
    }
    return result;
  }, [searchParams, defaults]);

  const setFilter = useCallback(
    (key: keyof T, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === defaults[key]) {
        params.delete(key as string);
      } else {
        params.set(key as string, value);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams, defaults]
  );

  return [values, setFilter];
}
