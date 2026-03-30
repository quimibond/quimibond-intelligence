"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface SidebarCounts {
  alerts: number;
  actions: number;
}

let cachedCounts: SidebarCounts | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 30_000; // 30 seconds

export function useSidebarCounts(): SidebarCounts {
  const [counts, setCounts] = useState<SidebarCounts>(cachedCounts ?? { alerts: 0, actions: 0 });

  useEffect(() => {
    async function fetch() {
      if (cachedCounts && Date.now() < cacheExpiry) {
        setCounts(cachedCounts);
        return;
      }

      const [alertsRes, actionsRes] = await Promise.all([
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
      ]);

      const newCounts = {
        alerts: alertsRes.count ?? 0,
        actions: actionsRes.count ?? 0,
      };
      cachedCounts = newCounts;
      cacheExpiry = Date.now() + CACHE_TTL;
      setCounts(newCounts);
    }

    fetch();
    const interval = setInterval(fetch, CACHE_TTL);
    return () => clearInterval(interval);
  }, []);

  return counts;
}
