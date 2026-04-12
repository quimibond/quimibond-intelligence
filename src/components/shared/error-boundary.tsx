"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (typeof window !== "undefined") {
      console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ""}]`, error, errorInfo);
    }
  }

  private reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <Card className="border-danger/40 bg-danger/5">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="h-8 w-8 text-danger" />
          <div>
            <p className="text-sm font-semibold">Error al cargar esta sección</p>
            <p className="text-xs text-muted-foreground mt-1">
              {this.state.error?.message ?? "Ocurrió un error inesperado."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={this.reset}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }
}
