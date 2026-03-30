"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Select } from "@/components/ui/select";

interface AssigneeOption {
  email: string;
  name: string;
}

let cachedUsers: AssigneeOption[] | null = null;

export function AssigneeSelect({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (email: string | null, name: string | null) => void;
  className?: string;
}) {
  const [users, setUsers] = useState<AssigneeOption[]>(cachedUsers ?? []);

  useEffect(() => {
    if (cachedUsers) return;
    async function load() {
      const { data } = await supabase
        .from("odoo_users")
        .select("email, name")
        .order("name");
      if (data) {
        const opts = (data as AssigneeOption[]).filter(u => u.email);
        cachedUsers = opts;
        setUsers(opts);
      }
    }
    load();
  }, []);

  return (
    <Select
      value={value ?? ""}
      onChange={(e) => {
        const email = e.target.value || null;
        const user = users.find(u => u.email === email);
        onChange(email, user?.name ?? null);
      }}
      className={className}
    >
      <option value="">Sin asignar</option>
      {users.map((u) => (
        <option key={u.email} value={u.email}>
          {u.name}
        </option>
      ))}
    </Select>
  );
}
