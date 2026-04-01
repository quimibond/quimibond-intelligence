import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const { query } = (await req.json()) as { query?: string };

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        { contacts: [], companies: [], insights: [], facts: [], emails: [] },
        { status: 200 }
      );
    }

    const supabase = getServiceClient();
    const trimmed = query.trim();
    const pattern = `%${trimmed}%`;

    const [contacts, companies, insights, facts, emails] = await Promise.all([
      supabase
        .from("contacts")
        .select("id, name, email, company_id, risk_level")
        .or(`name.ilike.${pattern},email.ilike.${pattern}`)
        .limit(10),
      supabase
        .from("companies")
        .select("id, name, canonical_name, is_customer, is_supplier")
        .or(`name.ilike.${pattern},canonical_name.ilike.${pattern}`)
        .limit(10),
      supabase
        .from("agent_insights")
        .select("id, title, description, severity, state, created_at, assignee_name")
        .or(`title.ilike.${pattern},description.ilike.${pattern}`)
        .in("state", ["new", "seen", "acted_on"])
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("facts")
        .select("id, fact_text, confidence, entity_id, created_at")
        .ilike("fact_text", pattern)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("emails")
        .select("id, subject, snippet, sender, email_date")
        .or(`subject.ilike.${pattern},snippet.ilike.${pattern},sender.ilike.${pattern}`)
        .order("email_date", { ascending: false })
        .limit(10),
    ]);

    return NextResponse.json({
      contacts: contacts.data ?? [],
      companies: companies.data ?? [],
      insights: insights.data ?? [],
      facts: facts.data ?? [],
      emails: emails.data ?? [],
    });
  } catch (error) {
    console.error("[search] Error:", error);
    return NextResponse.json(
      { error: "Error al buscar" },
      { status: 500 }
    );
  }
}
