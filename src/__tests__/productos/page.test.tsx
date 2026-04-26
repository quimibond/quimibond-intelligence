import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  getProductsKpisMock,
  getInventoryPageMock,
  getProductCategoryOptionsMock,
  getTopMoversPageMock,
  getDeadStockPageMock,
  getTopMarginProductsMock,
} = vi.hoisted(() => ({
  getProductsKpisMock: vi.fn(async () => ({
    catalogActive: 6008,
    needsReorder: 23,
    deadStock: 412,
    avgMargin: 0.18,
  })),
  getInventoryPageMock: vi.fn(async () => ({ rows: [], total: 0 })),
  getProductCategoryOptionsMock: vi.fn(async () => [] as string[]),
  getTopMoversPageMock: vi.fn(async () => ({ rows: [], total: 0 })),
  getDeadStockPageMock: vi.fn(async () => ({ rows: [], total: 0 })),
  getTopMarginProductsMock: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/queries/analytics/products", () => ({
  getProductsKpis: getProductsKpisMock,
  getInventoryPage: getInventoryPageMock,
  getProductCategoryOptions: getProductCategoryOptionsMock,
  getTopMoversPage: getTopMoversPageMock,
  getDeadStockPage: getDeadStockPageMock,
  getTopMarginProducts: getTopMarginProductsMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/productos",
  useSearchParams: () => new URLSearchParams(),
}));

import ProductosPage from "@/app/productos/page";

async function renderPage(search: Record<string, string> = {}) {
  const ui = await ProductosPage({ searchParams: Promise.resolve(search) });
  const { container } = render(ui);
  await new Promise((r) => setTimeout(r, 0));
  return container;
}

describe("/productos page", () => {
  it("renders the SP13 question-framed subtitle", async () => {
    await renderPage();
    expect(
      screen.getByText(/¿Qué tengo en inventario, qué rota bien y qué está muerto\?/),
    ).toBeInTheDocument();
  });

  it("invokes the four section queries", async () => {
    getProductsKpisMock.mockClear();
    getInventoryPageMock.mockClear();
    getTopMoversPageMock.mockClear();
    getDeadStockPageMock.mockClear();
    getTopMarginProductsMock.mockClear();
    await renderPage();
    expect(getProductsKpisMock).toHaveBeenCalled();
    // The other helpers are called inside Suspense'd async sub-components;
    // they should each fire at least once during render.
    expect(getInventoryPageMock).toHaveBeenCalled();
    expect(getTopMoversPageMock).toHaveBeenCalled();
    expect(getDeadStockPageMock).toHaveBeenCalled();
    expect(getTopMarginProductsMock).toHaveBeenCalled();
  });

  it("renders the four question-first section headings", async () => {
    await renderPage();
    expect(screen.getByText(/¿Qué necesito reordenar urgente\?/)).toBeInTheDocument();
    expect(screen.getByText(/¿Qué se vende más\?/)).toBeInTheDocument();
    expect(
      screen.getByText(/¿Dónde tengo márgenes finos vs\. saludables\?/),
    ).toBeInTheDocument();
    expect(screen.getByText(/¿Qué se quedó muerto en el almacén\?/)).toBeInTheDocument();
  });
});
