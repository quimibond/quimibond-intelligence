"use client";

import { useState, useCallback } from "react";
import { UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export function AssigneeSelector({ insightId, currentName, currentEmail, onChanged }: {
  insightId: number;
  currentName: string;
  currentEmail: string;
  onChanged: (name: string, email: string, dept: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ name: string; email: string; department: string | null }[]>([]);

  const loadUsers = useCallback(async () => {
    if (users.length > 0) { setOpen(!open); return; }
    const { data } = await supabase
      .from("odoo_users")
      .select("name, email, department")
      .not("email", "is", null)
      .order("name")
      .limit(50);
    setUsers((data ?? []) as typeof users);
    setOpen(true);
  }, [users, open]);

  const assign = useCallback(async (user: { name: string; email: string; department: string | null }) => {
    await supabase.from("agent_insights").update({
      assignee_name: user.name,
      assignee_email: user.email,
      assignee_department: user.department ?? "",
    }).eq("id", insightId);
    onChanged(user.name, user.email, user.department ?? "");
    setOpen(false);
  }, [insightId, onChanged]);

  return (
    <div className="mt-2">
      <button
        onClick={loadUsers}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
      >
        <UserCheck className="h-3 w-3" />
        <span>→ {currentName}</span>
        <span className="text-[10px] opacity-50">(cambiar)</span>
      </button>

      {open && (
        <Card className="mt-2 max-h-48 overflow-y-auto py-1">
          <CardContent className="p-0">
            {users.map((u) => (
              <button
                key={u.email}
                onClick={() => assign(u)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
                  u.email === currentEmail && "bg-primary/10 font-medium"
                )}
              >
                <span className="truncate">{u.name}</span>
                <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                  {u.department ?? ""}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
