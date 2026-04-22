import { describe, it, expect, beforeAll } from "vitest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("_shared/contacts.ts — canonical reads", () => {
  let fetchContactById: (id: number) => Promise<unknown>;
  let listContacts: (opts: { search?: string; limit?: number }) => Promise<unknown[]>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/_shared/contacts");
    fetchContactById = (mod.fetchContactById ?? mod.getContactById) as typeof fetchContactById;
    listContacts = (mod.listContacts ?? mod.searchContacts) as typeof listContacts;
    if (!fetchContactById || !listContacts) throw new Error("exports missing");
  });

  it("listContacts returns canonical_contacts shape", async () => {
    const rows = await listContacts({ limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("id");
    // canonical_contacts-specific fields
    expect(rows[0]).toHaveProperty("email");
    expect(rows[0]).toHaveProperty("name");
  });

  it("fetchContactById returns a single row for a known id", async () => {
    const anyContact = await listContacts({ limit: 1 });
    expect(anyContact.length).toBe(1);
    const row = anyContact[0] as { id: number };
    const one = await fetchContactById(row.id);
    expect(one).toBeTruthy();
    expect((one as { id: number }).id).toBe(row.id);
  });
});

describe("_shared/contacts.ts — source has no banned legacy reads", () => {
  it("contacts.ts legacy table bans", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "src/lib/queries/_shared/contacts.ts",
      "utf8",
    );
    const banned = [
      "from('odoo_users",
      'from("odoo_users',
      "from('odoo_employees",
      'from("odoo_employees',
      "from('contacts'",
      'from("contacts"',
      "from('person_unified",
      'from("person_unified',
    ];
    for (const token of banned) {
      expect(src, `should not contain: ${token}`).not.toContain(token);
    }
  });
});
