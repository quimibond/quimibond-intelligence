import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { QuestionSection } from "@/components/patterns/question-section";

describe("<QuestionSection>", () => {
  it("renders the question as a heading", () => {
    render(
      <QuestionSection id="quien-compra" question="¿Quién me compra más este trimestre?">
        <div>content</div>
      </QuestionSection>
    );
    expect(
      screen.getByRole("heading", { name: /Quién me compra más/i })
    ).toBeInTheDocument();
  });

  it("renders subtext when provided", () => {
    render(
      <QuestionSection
        id="q"
        question="Q?"
        subtext="Ordenado por facturación SAT del trimestre."
      >
        <div />
      </QuestionSection>
    );
    expect(screen.getByText(/Ordenado por facturación SAT/)).toBeInTheDocument();
  });

  it("wraps children", () => {
    render(
      <QuestionSection id="q" question="Q?">
        <div data-testid="child">hello</div>
      </QuestionSection>
    );
    expect(screen.getByTestId("child")).toHaveTextContent("hello");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <QuestionSection id="q" question="Q?">
        <div />
      </QuestionSection>
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
