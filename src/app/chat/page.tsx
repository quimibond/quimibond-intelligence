"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, ThumbsDown, ThumbsUp, User, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { DIRECTOR_META, DIRECTOR_SLUGS, type DirectorSlug } from "@/lib/agents/director-chat-context";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  rated?: "positive" | "negative" | null;
  /** Slug del director que respondio (solo assistant). */
  directorSlug?: DirectorSlug;
  /** Label para mostrar (ej: "Director Financiero"). */
  directorLabel?: string;
}

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content: "Hola! Preguntame sobre cualquier empresa, cliente, proveedor o situacion del negocio. Puedes mencionar a un director con @financiero, @compras, @comercial, @costos, @operaciones, @riesgo o @equipo para pedirle un reporte especifico.",
};

const FALLBACK_QUESTIONS = [
  "Cuales son las alertas criticas de hoy?",
  "Resume el ultimo briefing",
  "@financiero flujo de efectivo proyectado a 60 dias",
  "@compras reporte de compras del mes",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_QUESTIONS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load dynamic suggestions from active insights
  useEffect(() => {
    async function loadSuggestions() {
      const { data: insights } = await supabase
        .from("agent_insights")
        .select("title, company_id")
        .in("state", ["new", "seen"])
        .in("severity", ["critical", "high"])
        .gte("confidence", 0.80)
        .order("created_at", { ascending: false })
        .limit(4);

      if (insights?.length) {
        const dynamic = insights.map(i => {
          const title = String(i.title);
          // Convert insight title to a question
          if (title.includes(":")) {
            const company = title.split(":")[0].trim();
            return `Como va ${company}?`;
          }
          return `Explicame: ${title.slice(0, 60)}`;
        });
        // Mix dynamic + 1 fallback
        setSuggestions([...new Set(dynamic), FALLBACK_QUESTIONS[0]].slice(0, 4));
      }
    }
    loadSuggestions();
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [messages, loading]);

  const sendMessage = useCallback(
    async (text?: string) => {
      const messageText = (text ?? input).trim();
      if (!messageText || loading) return;

      const userMessage: ChatMessage = { role: "user", content: messageText };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: messageText,
            history: updatedMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.includes("text/event-stream")) {
          // Streaming response — render progressively
          const placeholder: ChatMessage = { role: "assistant", content: "" };
          setMessages((prev) => [...prev, placeholder]);

          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";
          let detectedSlug: DirectorSlug | undefined;
          let detectedLabel: string | undefined;

          if (reader) {
            let buffer = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                  if (!line.startsWith("data: ")) continue;
                  try {
                    const event = JSON.parse(line.slice(6));
                    if (event.type === "director" && event.slug) {
                      // Primer evento antes del texto: pinta el badge del director.
                      detectedSlug = event.slug as DirectorSlug;
                      detectedLabel = event.label as string;
                      setMessages((prev) => {
                        const copy = [...prev];
                        copy[copy.length - 1] = {
                          role: "assistant",
                          content: "",
                          directorSlug: detectedSlug,
                          directorLabel: detectedLabel,
                        };
                        return copy;
                      });
                    } else if (event.type === "delta" && event.text) {
                      accumulated += event.text;
                      const text = accumulated;
                      setMessages((prev) => {
                        const copy = [...prev];
                        copy[copy.length - 1] = {
                          role: "assistant",
                          content: text,
                          directorSlug: detectedSlug,
                          directorLabel: detectedLabel,
                        };
                        return copy;
                      });
                    }
                  } catch {
                    // skip
                  }
                }
              }
            } catch (err) {
              console.error("[chat] Stream read error:", err);
              if (accumulated) {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", content: accumulated + "\n\n[Respuesta interrumpida]" };
                  return updated;
                });
              }
            }
          }

          if (!accumulated) {
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: "No se obtuvo respuesta." };
              return copy;
            });
          }
        } else {
          // Non-streaming fallback (error responses come as JSON)
          const data = await res.json();
          const errorMsg = data.error
            ? `${data.error}${data.detail ? `\n\n\`\`\`\n${typeof data.detail === "string" ? data.detail.slice(0, 500) : JSON.stringify(data.detail).slice(0, 500)}\n\`\`\`` : ""}`
            : null;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.response ?? errorMsg ?? "Error: no se recibio respuesta.",
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Error de conexion. Intenta de nuevo.",
          },
        ]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [input, loading, messages]
  );

  async function rateMessage(index: number, rating: "positive" | "negative") {
    const msg = messages[index];
    if (!msg || msg.role !== "assistant") return;

    const newRating = msg.rated === rating ? null : rating;

    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, rated: newRating } : m))
    );

    // Find the user question that preceded this answer
    const questionMsg = messages[index - 1];
    if (!questionMsg || questionMsg.role !== "user") return;

    // Save to chat_memory if positive (real schema: rating=integer, thumbs_up=boolean)
    if (newRating === "positive") {
      try {
        await supabase.from("chat_memory").insert({
          question: questionMsg.content,
          answer: msg.content,
          thumbs_up: true,
          rating: 1,
        });
      } catch {
        // Table columns may differ
      }
    }

    // feedback_signals table removed
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const showSuggestions = messages.length <= 1 && !loading;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] md:h-[calc(100vh-8rem)]">
      <PageHeader
        title="Chat IA"
        description="Asistente de inteligencia ejecutiva"
      />

      <Card className="flex-1 flex flex-col overflow-hidden">
        <ScrollArea className="flex-1 p-4">
          <div ref={scrollRef} className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-3 max-w-[92%] sm:max-w-[85%]",
                  msg.role === "user"
                    ? "ml-auto flex-row-reverse"
                    : "mr-auto"
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  {msg.role === "user" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </div>
                <div className="space-y-1">
                  {msg.role === "assistant" && msg.directorLabel && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Briefcase className="h-3 w-3" />
                      {msg.directorLabel}
                    </Badge>
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    {msg.content}
                  </div>
                  {/* Feedback buttons for assistant messages (skip welcome) */}
                  {msg.role === "assistant" && i > 0 && (
                    <div className="flex items-center gap-1 pl-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Marcar respuesta como util"
                        aria-pressed={msg.rated === "positive"}
                        className={cn(
                          "h-6 w-6 p-0",
                          msg.rated === "positive" &&
                            "text-success-foreground"
                        )}
                        onClick={() => rateMessage(i, "positive")}
                      >
                        <ThumbsUp
                          className={cn(
                            "h-3 w-3",
                            msg.rated === "positive" && "fill-current"
                          )}
                        />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Marcar respuesta como no util"
                        aria-pressed={msg.rated === "negative"}
                        className={cn(
                          "h-6 w-6 p-0",
                          msg.rated === "negative" &&
                            "text-danger-foreground"
                        )}
                        onClick={() => rateMessage(i, "negative")}
                      >
                        <ThumbsDown
                          className={cn(
                            "h-3 w-3",
                            msg.rated === "negative" && "fill-current"
                          )}
                        />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex gap-3 mr-auto max-w-[92%] sm:max-w-[85%]">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-lg bg-muted px-4 py-2.5 text-sm">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce">.</span>
                    <span className="animate-bounce [animation-delay:0.2s]">
                      .
                    </span>
                    <span className="animate-bounce [animation-delay:0.4s]">
                      .
                    </span>
                  </span>
                </div>
              </div>
            )}

            {/* Suggested questions */}
            {showSuggestions && (
              <div className="pt-4">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Preguntas sugeridas
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="rounded-lg border bg-background px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="border-t p-3 md:p-4 safe-area-bottom">
          {/* Director chips — insertan el @mention en el input */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {DIRECTOR_SLUGS.map(slug => {
              const meta = DIRECTOR_META[slug];
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => {
                    const prefix = `@${slug} `;
                    setInput(prev => prev.startsWith("@") ? prefix + prev.replace(/^@\w+\s*/, "") : prefix + prev);
                    inputRef.current?.focus();
                  }}
                  className="text-[10px] rounded-full border bg-background px-2 py-1 hover:bg-muted transition-colors"
                  title={meta.sampleQuestions[0]}
                >
                  @{slug}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              placeholder="Pregunta algo o menciona un director: @financiero, @compras, @comercial..."
              aria-label="Mensaje para el asistente"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="flex-1 h-11 md:h-10 text-base md:text-sm"
            />
            <Button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              size="icon"
              aria-label="Enviar mensaje"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Conectado a Claude con contexto RAG de Supabase. Los directores usan sus prompts y datos especificos.
          </p>
        </div>
      </Card>
    </div>
  );
}
