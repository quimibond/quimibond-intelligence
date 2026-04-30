import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CommsEmptyState } from "./CommsEmptyState";

describe("CommsEmptyState", () => {
  it("muestra texto contextual para empresa", () => {
    render(<CommsEmptyState entityType="company" />);
    expect(screen.getByText(/no hay comunicaciones/i)).toBeInTheDocument();
    expect(screen.getByText(/contacto principal/i)).toBeInTheDocument();
  });

  it("muestra texto contextual para contacto", () => {
    render(<CommsEmptyState entityType="contact" />);
    expect(screen.getByText(/sin emails sincronizados/i)).toBeInTheDocument();
  });
});
