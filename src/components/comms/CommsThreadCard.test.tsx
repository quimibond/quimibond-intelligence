import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CommsThreadCard } from "./CommsThreadCard";
import type { CommsThread } from "@/lib/queries/comms/timeline";

const baseThread: CommsThread = {
  thread_id: 1,
  gmail_thread_id: "gt_xyz",
  subject: "Cotización paño",
  last_activity: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  last_sender: "maria@cliente.com",
  last_sender_type: "external",
  hours_without_response: 96,
  status: "open",
  message_count: 4,
  has_internal_reply: true,
  has_external_reply: true,
  participant_emails: ["maria@cliente.com"],
  severity: "medium",
  total_count: 1,
};

describe("CommsThreadCard", () => {
  it("muestra subject + last_sender + message_count", () => {
    render(<CommsThreadCard thread={baseThread} onSelect={() => {}} />);
    expect(screen.getByText("Cotización paño")).toBeInTheDocument();
    expect(screen.getByText(/maria@cliente.com/)).toBeInTheDocument();
    expect(screen.getByText(/4 mensajes/)).toBeInTheDocument();
  });

  it("muestra horas sin respuesta cuando severity != none", () => {
    render(<CommsThreadCard thread={baseThread} onSelect={() => {}} />);
    expect(screen.getByText(/96h sin respuesta/)).toBeInTheDocument();
  });

  it("oculta horas sin respuesta cuando severity = none", () => {
    render(
      <CommsThreadCard
        thread={{ ...baseThread, severity: "none" }}
        onSelect={() => {}}
      />
    );
    expect(screen.queryByText(/sin respuesta/)).not.toBeInTheDocument();
  });

  it("dispara onSelect con thread_id al click", () => {
    const onSelect = vi.fn();
    render(<CommsThreadCard thread={baseThread} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Cotización paño/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("usa fallback '(sin asunto)' cuando subject es null", () => {
    render(
      <CommsThreadCard
        thread={{ ...baseThread, subject: null }}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText("(sin asunto)")).toBeInTheDocument();
  });
});
