"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import {
  Filter,
  Maximize2,
  RefreshCw,
  Users,
  Building2,
  ArrowRightLeft,
  Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──

interface NetNode extends SimulationNodeDatum {
  id: number;
  name: string;
  email: string;
  company_id: number | null;
  company_name: string | null;
  contact_type: string | null;
  risk_level: string | null;
  role: string | null;
  total_sent: number;
  total_received: number;
}

interface NetEdge extends SimulationLinkDatum<NetNode> {
  source: number | NetNode;
  target: number | NetNode;
  weight: number;
  is_bidirectional: boolean;
  is_internal: boolean;
}

interface NetworkData {
  nodes: NetNode[];
  edges: NetEdge[];
  stats: {
    total_nodes: number;
    total_edges: number;
    bidirectional_edges: number;
    internal_edges: number;
  };
}

// ── Colors ──

const COMPANY_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

function getCompanyColor(companyId: number | null, companyMap: Map<number, number>): string {
  if (companyId == null) return "#6b7280";
  if (!companyMap.has(companyId)) {
    companyMap.set(companyId, companyMap.size);
  }
  return COMPANY_COLORS[companyMap.get(companyId)! % COMPANY_COLORS.length];
}

// ── Component ──

export default function NetworkPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [minEmails, setMinEmails] = useState(2);
  const [internalOnly, setInternalOnly] = useState<boolean | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NetNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetNode | null>(null);
  const nodesRef = useRef<NetNode[]>([]);
  const edgesRef = useRef<NetEdge[]>([]);
  const simRef = useRef<ReturnType<typeof forceSimulation<NetNode>> | null>(null);
  const companyColorMap = useRef(new Map<number, number>());

  const fetchNetwork = useCallback(async () => {
    setLoading(true);
    const { data: rpcData } = await supabase.rpc("get_communication_network", {
      p_min_emails: minEmails,
      p_internal_only: internalOnly,
    });
    if (rpcData) {
      setData(rpcData as NetworkData);
    }
    setLoading(false);
  }, [minEmails, internalOnly]);

  useEffect(() => { fetchNetwork(); }, [fetchNetwork]);

  // D3 force simulation
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.parentElement!.getBoundingClientRect();
    const W = rect.width;
    const H = Math.max(500, window.innerHeight - 350);
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const nodes: NetNode[] = data.nodes.map((n) => ({ ...n }));
    const edges: NetEdge[] = data.edges.map((e) => ({ ...e }));
    nodesRef.current = nodes;
    edgesRef.current = edges;

    const maxWeight = Math.max(...edges.map((e) => e.weight), 1);

    const sim = forceSimulation<NetNode>(nodes)
      .force("link", forceLink<NetNode, NetEdge>(edges)
        .id((d) => d.id)
        .distance((d) => 120 - (d.weight / maxWeight) * 60)
        .strength((d) => 0.3 + (d.weight / maxWeight) * 0.5)
      )
      .force("charge", forceManyBody().strength(-200))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide(20));

    simRef.current = sim;

    function draw() {
      ctx!.clearRect(0, 0, W, H);

      // Draw edges
      for (const edge of edges) {
        const s = edge.source as NetNode;
        const t = edge.target as NetNode;
        if (s.x == null || t.x == null) continue;

        const alpha = 0.15 + (edge.weight / maxWeight) * 0.6;
        const width = 0.5 + (edge.weight / maxWeight) * 3;

        ctx!.beginPath();
        ctx!.moveTo(s.x, s.y!);
        ctx!.lineTo(t.x, t.y!);
        ctx!.strokeStyle = edge.is_internal
          ? `rgba(59, 130, 246, ${alpha})`
          : `rgba(249, 115, 22, ${alpha})`;
        ctx!.lineWidth = width;
        ctx!.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        if (node.x == null) continue;
        const r = 5 + Math.min((node.total_sent + node.total_received) / 10, 15);
        const color = getCompanyColor(node.company_id, companyColorMap.current);
        const isHovered = hoveredNode?.id === node.id;
        const isSelected = selectedNode?.id === node.id;

        ctx!.beginPath();
        ctx!.arc(node.x, node.y!, r, 0, Math.PI * 2);
        ctx!.fillStyle = color;
        ctx!.fill();

        if (isHovered || isSelected) {
          ctx!.strokeStyle = "#fff";
          ctx!.lineWidth = 2;
          ctx!.stroke();

          // Label
          ctx!.font = "11px -apple-system, sans-serif";
          ctx!.fillStyle = "#fff";
          ctx!.textAlign = "center";
          ctx!.fillText(node.name ?? node.email, node.x, node.y! - r - 6);
        }
      }
    }

    sim.on("tick", draw);

    // Mouse interaction
    function getNodeAt(mx: number, my: number): NetNode | null {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.x == null) continue;
        const r = 5 + Math.min((n.total_sent + n.total_received) / 10, 15);
        const dx = mx - n.x;
        const dy = my - (n.y ?? 0);
        if (dx * dx + dy * dy < r * r) return n;
      }
      return null;
    }

    function onMouseMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = getNodeAt(mx, my);
      setHoveredNode(node);
      canvas.style.cursor = node ? "pointer" : "default";
      draw();
    }

    function onClick(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = getNodeAt(mx, my);
      setSelectedNode(node);
      draw();
    }

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("click", onClick);

    return () => {
      sim.stop();
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onClick);
    };
  }, [data, hoveredNode, selectedNode]);

  // Get edges for selected node
  const selectedEdges = selectedNode
    ? edgesRef.current.filter((e) => {
        const s = typeof e.source === "number" ? e.source : e.source.id;
        const t = typeof e.target === "number" ? e.target : e.target.id;
        return s === selectedNode.id || t === selectedNode.id;
      })
    : [];

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Red de Comunicacion" description="Grafo interactivo de comunicaciones por email" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[100px]" />)}
        </div>
        <Skeleton className="h-[500px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Red de Comunicacion" description="Grafo interactivo de comunicaciones por email">
        <Button variant="outline" size="sm" onClick={fetchNetwork} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </PageHeader>

      {/* Stats */}
      {data?.stats && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard title="Contactos" value={data.stats.total_nodes} icon={Users} />
          <StatCard title="Conexiones" value={data.stats.total_edges} icon={ArrowRightLeft} />
          <StatCard title="Bidireccionales" value={data.stats.bidirectional_edges} icon={Zap} />
          <StatCard title="Internas" value={data.stats.internal_edges} icon={Building2} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Min emails:</span>
          {[1, 2, 3, 5, 10].map((n) => (
            <Button
              key={n}
              variant={minEmails === n ? "default" : "outline"}
              size="sm"
              onClick={() => setMinEmails(n)}
            >
              {n}+
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Tipo:</span>
          <Button
            variant={internalOnly === null ? "default" : "outline"}
            size="sm"
            onClick={() => setInternalOnly(null)}
          >
            Todos
          </Button>
          <Button
            variant={internalOnly === true ? "default" : "outline"}
            size="sm"
            onClick={() => setInternalOnly(true)}
          >
            Interno
          </Button>
          <Button
            variant={internalOnly === false ? "default" : "outline"}
            size="sm"
            onClick={() => setInternalOnly(false)}
          >
            Externo
          </Button>
        </div>
      </div>

      {/* Graph + Detail panel */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Canvas */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-0 overflow-hidden rounded-lg">
              <canvas ref={canvasRef} className="w-full bg-background" />
            </CardContent>
          </Card>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded bg-blue-500" /> Interno
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded bg-orange-500" /> Externo
            </span>
            <span>Tamaño = volumen de emails</span>
            <span>Grosor = frecuencia</span>
          </div>
        </div>

        {/* Detail panel */}
        <div>
          {selectedNode ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{selectedNode.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{selectedNode.email}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {selectedNode.company_name && (
                    <Badge variant="outline">{selectedNode.company_name}</Badge>
                  )}
                  {selectedNode.role && <Badge variant="secondary">{selectedNode.role}</Badge>}
                  {selectedNode.risk_level && (
                    <Badge variant={selectedNode.risk_level === "high" ? "critical" : selectedNode.risk_level === "medium" ? "warning" : "success"}>
                      {selectedNode.risk_level}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded border p-2 text-center">
                    <p className="text-lg font-bold">{selectedNode.total_sent}</p>
                    <p className="text-xs text-muted-foreground">Enviados</p>
                  </div>
                  <div className="rounded border p-2 text-center">
                    <p className="text-lg font-bold">{selectedNode.total_received}</p>
                    <p className="text-xs text-muted-foreground">Recibidos</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold mb-1">Conexiones ({selectedEdges.length})</p>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {selectedEdges
                      .sort((a, b) => b.weight - a.weight)
                      .map((edge, i) => {
                        const s = edge.source as NetNode;
                        const t = edge.target as NetNode;
                        const peer = s.id === selectedNode.id ? t : s;
                        const direction = s.id === selectedNode.id ? "→" : "←";
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs rounded px-2 py-1 hover:bg-muted/50">
                            <span>{direction}</span>
                            <Link href={`/contacts/${peer.id}`} className="text-primary hover:underline truncate flex-1">
                              {peer.name ?? peer.email}
                            </Link>
                            <Badge variant="outline" className="shrink-0">{edge.weight}</Badge>
                            {edge.is_bidirectional && <Zap className="h-3 w-3 text-amber-500" />}
                          </div>
                        );
                      })}
                  </div>
                </div>

                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/contacts/${selectedNode.id}`}>
                    Ver perfil completo
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Maximize2 className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  Haz clic en un nodo para ver los detalles de comunicacion
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
