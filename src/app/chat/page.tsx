'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Bot,
  User,
  Send,
  ThumbsUp,
  ThumbsDown,
  Loader2,
} from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  id: string;
}

interface Feedback {
  messageId: string;
  rating: 'thumbs_up' | 'thumbs_down';
}

const SUGGESTED_QUESTIONS = [
  '¿Cuáles son las alertas más urgentes?',
  '¿Qué contactos requieren atención?',
  'Resume el briefing de hoy',
  '¿Qué acciones están pendientes?',
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastAssistantMessageRef = useRef<string | null>(null);

  // Initialize session ID on mount
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (text?: string) => {
    const messageText = text || inputValue.trim();
    if (!messageText || loading) return;

    setInputValue('');

    // Add user message
    const userMessageId = crypto.randomUUID();
    const userMessage: Message = {
      role: 'user',
      content: messageText,
      timestamp: new Date(),
      id: userMessageId,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Detect rephrase: if user sends message right after thumbs_down
    const isRephrase = feedback?.rating === 'thumbs_down';

    setLoading(true);

    try {
      // Get last 10 messages for context
      const history = messages.slice(-10).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: messageText,
          history,
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const data = await response.json();
      const assistantMessageId = crypto.randomUUID();

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
        id: assistantMessageId,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      lastAssistantMessageRef.current = assistantMessageId;
      setFeedback(null);

      // Save the interaction
      if (sessionId) {
        await supabase.from('chat_feedback').insert({
          question: messageText,
          response: data.answer,
          rating: null,
          is_rephrase: isRephrase,
          session_id: sessionId,
          created_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Lo siento, ocurrió un error. Por favor, intenta de nuevo.',
        timestamp: new Date(),
        id: crypto.randomUUID(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (
    rating: 'thumbs_up' | 'thumbs_down'
  ) => {
    if (!lastAssistantMessageRef.current || !sessionId) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== 'assistant') return;

    setFeedback({
      messageId: lastAssistantMessageRef.current,
      rating,
    });

    try {
      // Save feedback to database
      const questionMessage = messages[messages.length - 2];
      await supabase.from('chat_feedback').insert({
        question: questionMessage?.content || '',
        response: lastMessage.content,
        rating,
        is_rephrase: false,
        session_id: sessionId,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Feedback error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">Chat Inteligente</h1>
            <p className="text-gray-600">
              Haz preguntas sobre alertas, contactos, acciones y briefings
            </p>
          </div>

          {/* Chat Container */}
          <Card className="border border-gray-200 bg-white shadow-sm flex flex-col h-[calc(100vh-320px)] min-h-[500px]">
            {/* Messages Area */}
            <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                    <Bot className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="text-center space-y-2">
                    <h2 className="text-lg font-semibold text-gray-900">
                      Bienvenido al Chat
                    </h2>
                    <p className="text-sm text-gray-600">
                      Haz una pregunta para comenzar
                    </p>
                  </div>

                  {/* Suggested Questions */}
                  <div className="grid grid-cols-1 gap-3 w-full max-w-sm mt-6">
                    {SUGGESTED_QUESTIONS.map((question, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendMessage(question)}
                        className="text-left px-4 py-3 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-sm text-gray-700 transition-colors"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'flex gap-3 animate-fade-in',
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      )}
                    >
                      {message.role === 'assistant' && (
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-1">
                          <Bot className="h-5 w-5 text-blue-600" />
                        </div>
                      )}

                      <div
                        className={cn(
                          'max-w-md rounded-lg p-4',
                          message.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-900'
                        )}
                      >
                        <p className="text-sm leading-relaxed">{message.content}</p>
                      </div>

                      {message.role === 'user' && (
                        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0 mt-1">
                          <User className="h-5 w-5 text-white" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Feedback Buttons */}
                  {messages.length > 0 &&
                    messages[messages.length - 1]?.role === 'assistant' && (
                      <div className="flex gap-2 justify-start pl-11 py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleFeedback('thumbs_up')}
                          className={cn(
                            'h-8 w-8 p-0',
                            feedback?.rating === 'thumbs_up'
                              ? 'bg-green-100 text-green-700'
                              : 'text-gray-400 hover:text-gray-600'
                          )}
                          title="Útil"
                        >
                          <ThumbsUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleFeedback('thumbs_down')}
                          className={cn(
                            'h-8 w-8 p-0',
                            feedback?.rating === 'thumbs_down'
                              ? 'bg-red-100 text-red-700'
                              : 'text-gray-400 hover:text-gray-600'
                          )}
                          title="No es útil"
                        >
                          <ThumbsDown className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                  {loading && (
                    <div className="flex gap-3 justify-start">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Bot className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="bg-gray-100 rounded-lg p-4 flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" />
                        <div
                          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                          style={{ animationDelay: '0.1s' }}
                        />
                        <div
                          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                          style={{ animationDelay: '0.2s' }}
                        />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </>
              )}
            </CardContent>

            {/* Input Area */}
            <div className="border-t border-gray-200 bg-white p-4 rounded-b-lg">
              <div className="flex gap-3">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Escribe tu pregunta..."
                  disabled={loading}
                  className="flex-1 bg-white border-gray-200"
                />
                <Button
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim() || loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
