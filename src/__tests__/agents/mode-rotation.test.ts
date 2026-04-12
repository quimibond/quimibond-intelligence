import { describe, it, expect, vi } from "vitest";
import { advanceMode } from "@/lib/agents/mode-rotation";

function mockSb(existing: { content?: string; id?: number } | null) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  return {
    _insert: insert,
    _update: update,
    _updateEq: updateEq,
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
          }),
        }),
      }),
      insert,
      update,
    }),
  };
}

describe("advanceMode", () => {
  it("devuelve primer modo si no hay memoria previa", async () => {
    const sb = mockSb(null);
    const mode = await advanceMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
    expect(sb._insert).toHaveBeenCalled();
    expect(sb._update).not.toHaveBeenCalled();
  });

  it("rota al siguiente modo", async () => {
    const sb = mockSb({ content: "operativo", id: 1 });
    const mode = await advanceMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("estrategico");
    expect(sb._update).toHaveBeenCalledWith(
      expect.objectContaining({ content: "estrategico" })
    );
  });

  it("vuelve al inicio tras el último", async () => {
    const sb = mockSb({ content: "estrategico", id: 1 });
    const mode = await advanceMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
    expect(sb._update).toHaveBeenCalledWith(
      expect.objectContaining({ content: "operativo" })
    );
  });

  it("si modes está vacío devuelve cadena vacía y no escribe", async () => {
    const sb = mockSb(null);
    const mode = await advanceMode(sb as never, 14, []);
    expect(mode).toBe("");
    expect(sb._insert).not.toHaveBeenCalled();
    expect(sb._update).not.toHaveBeenCalled();
  });

  it("si el modo guardado ya no está en la lista, arranca desde 0", async () => {
    const sb = mockSb({ content: "legacy", id: 1 });
    const mode = await advanceMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
    expect(sb._update).toHaveBeenCalled();
  });
});
