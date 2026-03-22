"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Send, Bot, User, Loader2, ThumbsUp, ThumbsDown } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Map<number, "thumbs_up" | "thumbs_down">>(new Map());
  const [sessionId, setSessionId] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // supabase is a lazy-loaded proxy from @/lib/supabase

  // Generate session ID on mount
  useEffect(() => {
    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: messages.slice(-10) }),
      });

      if (!res.ok) throw new Error("Error en la respuesta");

      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error al procesar tu pregunta. Verifica la configuracion del API." },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function checkRephrase(currentQuestion: string, previousQuestion: string): boolean {
    const getWords = (text: string) => text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const currentWords = new Set(getWords(currentQuestion));
    const previousWords = getWords(previousQuestion);
    const commonWords = previousWords.filter(w => currentWords.has(w));
    return commonWords.length >= 3;
  }

  async function handleFeedback(messageIndex: number, rating: "thumbs_up" | "thumbs_down") {
    // Find the assistant message and previous user message
    const assistantMessage = messages[messageIndex];
    const previousUserMessageIndex = messageIndex - 1;
    const previousUserMessage = previousUserMessageIndex >= 0 ? messages[previousUserMessageIndex] : null;

    if (!assistantMessage || assistantMessage.role !== "assistant" || !previousUserMessage) return;

    const currentQuestion = previousUserMessage.content;

    // Find if there's a message before the user message to check for rephrase
    let isRephrase = false;
    let originalQuestion: string | null = null;
    if (previousUserMessageIndex > 0) {
      const beforePreviousIndex = previousUserMessageIndex - 2; // Skip assistant message between
      if (beforePreviousIndex >= 0) {
        for (let i = beforePreviousIndex; i >= 0; i--) {
          if (messages[i].role === "user") {
            const prevUserMsg = messages[i].content;
            if (checkRephrase(currentQuestion, prevUserMsg)) {
              isRephrase = true;
              originalQuestion = prevUserMsg;
            }
            break;
          }
        }
      }
    }

    try {
      const { error } = await supabase.from("chat_feedback").insert({
        session_id: sessionId,
        question: currentQuestion,
        response: assistantMessage.content,
        rating,
        is_rephrase: isRephrase,
        original_question: originalQuestion,
        created_at: new Date().toISOString(),
      });

      if (error) {
        console.error("Error saving feedback:", error);
        return;
      }

      // Update local feedback state
      setFeedbackGiven(new Map(feedbackGiven).set(messageIndex, rating));
    } catch (err) {
      console.error("Error submitting feedback:", err);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Preguntar al Cerebro</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Haz preguntas sobre clientes, ventas, tendencias y mas
        </p>
      </div>

      {/* Messages */}
      <Card className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Bot className="mb-4 h-12 w-12 text-[var(--primary)] opacity-50" />
            <p className="text-lg font-medium">Hola, soy el cerebro de Quimibond</p>
            <p className="mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
              Puedo responder preguntas sobre tus clientes, analizar patrones de comunicacion,
              identificar oportunidades y mas. Preguntame lo que necesites.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                "Cuales son los clientes con mayor riesgo?",
                "Resume los briefings de esta semana",
                "Que acciones estan pendientes?",
                "Que tendencias ves en las ventas?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-left text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i}>
                <div className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/20">
                      <Bot className="h-4 w-4 text-[var(--primary)]" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] rounded-lg px-4 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-[var(--primary)] text-white"
                        : "bg-[var(--secondary)] text-[var(--foreground)]"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {msg.role === "user" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--secondary)]">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
                {msg.role === "assistant" && (
                  <div className="mt-2 flex gap-1 pl-11">
                    <button
                      onClick={() => handleFeedback(i, "thumbs_up")}
                      disabled={feedbackGiven.has(i)}
                      className="group relative h-6 w-6 flex items-center justify-center rounded-md hover:bg-[var(--accent)] transition-colors disabled:cursor-not-allowed"
                      title="Respuesta útil"
                    >
                      <ThumbsUp
                        className={`h-4 w-4 transition-colors ${
                          feedbackGiven.get(i) === "thumbs_up"
                            ? "text-[var(--success)] fill-[var(--success)]"
                            : "text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100"
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => handleFeedback(i, "thumbs_down")}
                      disabled={feedbackGiven.has(i)}
                      className="group relative h-6 w-6 flex items-center justify-center rounded-md hover:bg-[var(--accent)] transition-colors disabled:cursor-not-allowed"
                      title="Respuesta no útil"
                    >
                      <ThumbsDown
                        className={`h-4 w-4 transition-colors ${
                          feedbackGiven.get(i) === "thumbs_down"
                            ? "text-[var(--destructive)] fill-[var(--destructive)]"
                            : "text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100"
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/20">
                  <Bot className="h-4 w-4 text-[var(--primary)]" />
                </div>
                <div className="rounded-lg bg-[var(--secondary)] px-4 py-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </Card>

      {/* Input */}
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe tu pregunta..."
          rows={1}
          className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <Button type="submit" disabled={loading || !input.trim()} size="icon" className="h-12 w-12">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
