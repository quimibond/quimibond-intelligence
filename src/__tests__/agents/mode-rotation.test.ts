import { describe, it, expect, vi } from "vitest";
import { getNextMode } from "@/lib/agents/mode-rotation";

function mockSb(existing: { content?: string; id?: number } | null) {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    _upsert: upsert,
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
          }),
        }),
      }),
      upsert,
    }),
  };
}

describe("getNextMode", () => {
  it("devuelve primer modo si no hay memoria previa", async () => {
    const sb = mockSb(null);
    const mode = await getNextMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
    expect(sb._upsert).toHaveBeenCalled();
  });

  it("rota al siguiente modo", async () => {
    const sb = mockSb({ content: "operativo", id: 1 });
    const mode = await getNextMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("estrategico");
  });

  it("vuelve al inicio tras el último", async () => {
    const sb = mockSb({ content: "estrategico", id: 1 });
    const mode = await getNextMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
  });

  it("si modes está vacío devuelve cadena vacía y no escribe", async () => {
    const sb = mockSb(null);
    const mode = await getNextMode(sb as never, 14, []);
    expect(mode).toBe("");
    expect(sb._upsert).not.toHaveBeenCalled();
  });

  it("si el modo guardado ya no está en la lista, arranca desde 0", async () => {
    const sb = mockSb({ content: "legacy", id: 1 });
    const mode = await getNextMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
  });
});
