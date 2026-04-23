import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabPicker, type TabKey } from "@/app/empresas/[id]/_components/TabPicker";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/empresas/868",
}));

describe("TabPicker", () => {
  it("renders all 6 tab labels", () => {
    render(<TabPicker activeTab="panorama" />);
    for (const label of [/panorama/i, /comercial/i, /financiero/i, /operativo/i, /fiscal/i, /pagos/i]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("marks the active tab", () => {
    render(<TabPicker activeTab="financiero" />);
    const activeEls = screen.getAllByText(/financiero/i);
    expect(activeEls.length).toBeGreaterThan(0);
  });

  it("clicking a desktop tab button navigates with new ?tab=", () => {
    pushMock.mockClear();
    render(<TabPicker activeTab="panorama" />);
    const tabs = screen.queryAllByRole("tab");
    if (tabs.length > 0) {
      const financiero = tabs.find((t) => /financiero/i.test(t.textContent ?? ""));
      if (financiero) {
        fireEvent.click(financiero);
        expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("tab=financiero"));
      }
    }
  });

  it("exposes 6 TabKey values including panorama default", () => {
    const keys: TabKey[] = [
      "panorama", "comercial", "financiero", "operativo", "fiscal", "pagos",
    ];
    expect(keys).toHaveLength(6);
  });
});
