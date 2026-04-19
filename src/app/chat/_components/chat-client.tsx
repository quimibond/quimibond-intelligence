"use client";

import * as React from "react";
import { Bot, Loader2, Send, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  director?: { slug: string; label: string };
  pending?: boolean;
}

const SUGGESTIONS = [
  "¿Cuál es mi runway actual y qué clientes lo ponen en riesgo?",
  "Top 5 clientes que dejaron de comprar en los últimos 60 días",
  "@finanzas dame un resumen del flujo de caja del mes",
  "@ventas qué vendedor está bajando más en el trimestre",
  "Stock crítico que debo ordenar esta semana",
];

function generateId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function ChatClient() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new content
  React.useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Autogrow textarea
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
    };
    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setSending(true);

    // Historial que enviamos al backend (sin la nueva respuesta pending)
    const historyPayload = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyPayload }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Chat API error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let director: ChatMessage["director"];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;
          try {
            const event = JSON.parse(data);
            if (event.type === "director") {
              director = { slug: event.slug, label: event.label };
            } else if (event.type === "delta" && event.text) {
              assistantText += event.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: assistantText, director, pending: true }
                    : m
                )
              );
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        content: assistantText,
                        director,
                        pending: false,
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              throw new Error(event.error ?? "Stream error");
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }

      // Si terminó sin `done`, marcar como no pending igual
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: assistantText || m.content, pending: false }
            : m
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      toast.error(`Error en el chat: ${msg}`);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                content: `⚠️ ${msg}. Intenta de nuevo.`,
                pending: false,
              }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setInput("");
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col gap-4 pb-24 md:h-[calc(100vh-6rem)] md:pb-6">
      <PageHeader
        title="Chat con Claude"
        subtitle="Pregúntale cualquier cosa sobre tu negocio — @finanzas, @ventas, @compras activan directores"
        actions={
          hasMessages ? (
            <Button
              variant="outline"
              size="sm"
              onClick={clearChat}
              disabled={sending}
            >
              Limpiar chat
            </Button>
          ) : undefined
        }
      />

      {/* Mensajes */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden py-0">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 sm:px-6"
        >
          {!hasMessages ? (
            <EmptyChatState
              onPick={(s) => sendMessage(s)}
              disabled={sending}
            />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border bg-background/60 px-4 py-3 sm:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
            className="mx-auto flex max-w-3xl items-end gap-2"
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Pregúntale al CFO IA… (Shift+Enter para nueva línea)"
              disabled={sending}
              className="min-h-[44px] resize-none"
              rows={1}
            />
            <Button
              type="submit"
              disabled={sending || !input.trim()}
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label="Enviar mensaje"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
          <p className="mx-auto mt-1.5 max-w-3xl text-[10px] text-muted-foreground">
            Claude usa el briefing del día, insights activos, y datos en vivo de
            tu Supabase como contexto. Menciona <code>@finanzas</code>,{" "}
            <code>@ventas</code>, <code>@compras</code>, etc. para hablar con un
            director específico.
          </p>
        </div>
      </Card>
    </div>
  );
}

function EmptyChatState({
  onPick,
  disabled,
}: {
  onPick: (s: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="size-7 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">¿En qué te ayudo hoy?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pregúntale al CFO IA sobre tu negocio. Tiene acceso a Odoo, insights y
        el briefing diario en tiempo real.
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sugerencias
        </div>
        {SUGGESTIONS.map((s) => (
          <Button
            key={s}
            variant="outline"
            onClick={() => onPick(s)}
            disabled={disabled}
            className="h-auto justify-start rounded-lg px-4 py-3 text-left text-sm"
          >
            {s}
          </Button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex gap-3",
        isUser && "flex-row-reverse"
      )}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1",
          isUser && "items-end"
        )}
      >
        {message.director && (
          <Badge variant="info" className="w-fit text-[10px]">
            Director {message.director.label}
          </Badge>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm",
            message.pending && "animate-pulse"
          )}
        >
          {message.content ? (
            <MessageContent text={message.content} />
          ) : (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Pensando…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Renderizado básico de markdown: párrafos + bold (**) + listas.
 * Para output de Claude en español, esto es suficiente sin agregar librerías.
 */
function MessageContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let currentParagraph: string[] = [];
  let currentList: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length === 0) return;
    blocks.push(
      <p key={blocks.length} className="whitespace-pre-wrap">
        {formatInline(currentParagraph.join("\n"))}
      </p>
    );
    currentParagraph = [];
  };
  const flushList = () => {
    if (currentList.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc pl-5 space-y-1">
        {currentList.map((item, i) => (
          <li key={i}>{formatInline(item)}</li>
        ))}
      </ul>
    );
    currentList = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    // Heading (## or ###)
    if (/^#{2,3}\s+/.test(line)) {
      flushParagraph();
      flushList();
      const level = line.startsWith("###") ? 3 : 2;
      const text = line.replace(/^#+\s*/, "");
      blocks.push(
        level === 3 ? (
          <h4 key={blocks.length} className="mt-2 text-sm font-semibold">
            {formatInline(text)}
          </h4>
        ) : (
          <h3 key={blocks.length} className="mt-2 text-base font-semibold">
            {formatInline(text)}
          </h3>
        )
      );
      continue;
    }
    // Bullet list
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      flushParagraph();
      currentList.push(bulletMatch[1]);
      continue;
    }
    // Blank line
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    // Regular text
    flushList();
    currentParagraph.push(line);
  }
  flushParagraph();
  flushList();

  return <div className="space-y-2">{blocks}</div>;
}

function formatInline(text: string): React.ReactNode {
  // Split by bold markdown **...**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Inline code `...`
    const codeParts = part.split(/(`[^`]+`)/g);
    if (codeParts.length > 1) {
      return (
        <React.Fragment key={i}>
          {codeParts.map((p, j) =>
            p.startsWith("`") && p.endsWith("`") ? (
              <code
                key={j}
                className="rounded bg-background/50 px-1 py-0.5 font-mono text-[11px]"
              >
                {p.slice(1, -1)}
              </code>
            ) : (
              <React.Fragment key={j}>{p}</React.Fragment>
            )
          )}
        </React.Fragment>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
