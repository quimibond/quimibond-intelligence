"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import {
  Filter,
  GripHorizontal,
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
  // d3 adds these
  fx?: number | null;
  fy?: number | null;
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

// ── Canvas colors ──
// Canvas 2D context cannot read CSS variables directly, so we resolve them at
// runtime via getComputedStyle. The palette below maps to the design-system
// tokens defined in globals.css (info, success, warning, destructive, etc.)
// with additional hues for company differentiation.

function getCSSColor(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
}

/** Resolved at render-time so they respect light/dark theme. */
function getCanvasCompanyColors(): string[] {
  return [
    getCSSColor("--info", "#3b82f6"),
    getCSSColor("--success", "#10b981"),
    getCSSColor("--warning", "#f59e0b"),
    getCSSColor("--destructive", "#ef4444"),
    getCSSColor("--color-violet-500", "#8b5cf6"),
    getCSSColor("--color-pink-500", "#ec4899"),
    getCSSColor("--color-cyan-500", "#06b6d4"),
    getCSSColor("--color-lime-500", "#84cc16"),
    getCSSColor("--danger", "#f97316"),
    getCSSColor("--color-indigo-500", "#6366f1"),
  ];
}

function getCompanyColor(companyId: number | null, companyMap: Map<number, number>): string {
  if (companyId == null) return getCSSColor("--muted-foreground", "#6b7280");
  if (!companyMap.has(companyId)) companyMap.set(companyId, companyMap.size);
  const colors = getCanvasCompanyColors();
  return colors[companyMap.get(companyId)! % colors.length];
}

/** Convert a CSS color string + alpha to an rgba() canvas can use. */
function withAlpha(color: string, alpha: number): string {
  // If already rgb/rgba, inject alpha
  const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  // For hex colors
  const hexMatch = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hexMatch) {
    const [, r, g, b] = hexMatch;
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
  }
  // For oklch or other formats, use a temp canvas to resolve
  if (typeof document !== "undefined") {
    const tmp = document.createElement("canvas").getContext("2d");
    if (tmp) {
      tmp.fillStyle = color;
      const resolved = tmp.fillStyle; // browser normalizes to #rrggbb
      const m = resolved.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if (m) return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
    }
  }
  return `rgba(136, 136, 136, ${alpha})`;
}

function nodeRadius(n: NetNode): number {
  return 6 + Math.min((n.total_sent + n.total_received) / 8, 18);
}

// ── Component ──

export default function NetworkPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [minEmails, setMinEmails] = useState(2);
  const [internalOnly, setInternalOnly] = useState<boolean | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetNode | null>(null);
  const [selectedEdges, setSelectedEdges] = useState<NetEdge[]>([]);

  // Refs for simulation state (avoid re-creating simulation on state change)
  const nodesRef = useRef<NetNode[]>([]);
  const edgesRef = useRef<NetEdge[]>([]);
  const simRef = useRef<ReturnType<typeof forceSimulation<NetNode>> | null>(null);
  const companyColorMap = useRef(new Map<number, number>());
  const hoveredRef = useRef<NetNode | null>(null);
  const selectedRef = useRef<NetNode | null>(null);
  const dragRef = useRef<{ node: NetNode; offsetX: number; offsetY: number } | null>(null);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const sizeRef = useRef({ w: 0, h: 0 });

  const fetchNetwork = useCallback(async () => {
    setLoading(true);
    const { data: rpcData } = await supabase.rpc("get_communication_network", {
      p_min_emails: minEmails,
      p_internal_only: internalOnly,
    });
    if (rpcData) setData(rpcData as NetworkData);
    setLoading(false);
  }, [minEmails, internalOnly]);

  useEffect(() => { fetchNetwork(); }, [fetchNetwork]);

  // ── D3 force simulation (runs ONCE per data change, NOT on hover/select) ──
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Size
    const rect = canvas.parentElement!.getBoundingClientRect();
    const W = rect.width;
    const H = Math.max(500, window.innerHeight - 380);
    sizeRef.current = { w: W, h: H };
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Reset transform
    transformRef.current = { x: 0, y: 0, k: 1 };

    const nodes: NetNode[] = data.nodes.map((n) => ({ ...n }));
    const edges: NetEdge[] = data.edges.map((e) => ({ ...e }));
    nodesRef.current = nodes;
    edgesRef.current = edges;

    const maxWeight = Math.max(...edges.map((e) => e.weight), 1);

    // Simulation with gentle physics — settles fast, minimal jitter
    const sim = forceSimulation<NetNode>(nodes)
      .force("link", forceLink<NetNode, NetEdge>(edges)
        .id((d) => d.id)
        .distance(100)
        .strength((d) => 0.2 + (d.weight / maxWeight) * 0.3)
      )
      .force("charge", forceManyBody().strength(-150).distanceMax(400))
      .force("center", forceCenter(W / 2, H / 2).strength(0.05))
      .force("x", forceX(W / 2).strength(0.03))
      .force("y", forceY(H / 2).strength(0.03))
      .force("collide", forceCollide<NetNode>((d) => nodeRadius(d) + 3).strength(0.7))
      .alphaDecay(0.04)        // Settles ~2x faster than default
      .velocityDecay(0.4);     // High friction — stops bouncing

    simRef.current = sim;

    // ── Draw function ──
    function draw() {
      const isDark = document.documentElement.classList.contains("dark");
      const { x: tx, y: ty, k } = transformRef.current;
      ctx!.save();
      ctx!.clearRect(0, 0, W, H);
      ctx!.translate(tx, ty);
      ctx!.scale(k, k);

      const hovered = hoveredRef.current;
      const selected = selectedRef.current;

      // Highlight edges for selected/hovered node
      const activeNodeId = selected?.id ?? hovered?.id;

      // Resolve edge colors from design tokens (info = internal, warning = external)
      const edgeInternalColor = getCSSColor("--info", "#3b82f6");
      const edgeExternalColor = getCSSColor("--warning", "#f59e0b");

      // Draw edges
      for (const edge of edges) {
        const s = edge.source as NetNode;
        const t = edge.target as NetNode;
        if (s.x == null || t.x == null) continue;

        const isHighlighted = activeNodeId != null &&
          (s.id === activeNodeId || t.id === activeNodeId);

        const alpha = isHighlighted
          ? 0.7 + (edge.weight / maxWeight) * 0.3
          : 0.08 + (edge.weight / maxWeight) * 0.25;
        const width = isHighlighted
          ? 1.5 + (edge.weight / maxWeight) * 4
          : 0.5 + (edge.weight / maxWeight) * 2;

        ctx!.beginPath();
        ctx!.moveTo(s.x, s.y!);
        ctx!.lineTo(t.x, t.y!);
        ctx!.strokeStyle = edge.is_internal
          ? withAlpha(edgeInternalColor, alpha)
          : withAlpha(edgeExternalColor, alpha);
        ctx!.lineWidth = width;
        ctx!.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        if (node.x == null) continue;
        const r = nodeRadius(node);
        const color = getCompanyColor(node.company_id, companyColorMap.current);
        const isHovered = hovered?.id === node.id;
        const isSelected = selected?.id === node.id;
        const isDimmed = activeNodeId != null && !isHovered && !isSelected &&
          !edges.some((e) => {
            const s = (e.source as NetNode).id;
            const t = (e.target as NetNode).id;
            return (s === activeNodeId && t === node.id) || (t === activeNodeId && s === node.id);
          });

        ctx!.globalAlpha = isDimmed ? 0.15 : 1;

        // Shadow for hovered/selected
        if (isHovered || isSelected) {
          ctx!.shadowColor = color;
          ctx!.shadowBlur = 12;
        }

        ctx!.beginPath();
        ctx!.arc(node.x, node.y!, r, 0, Math.PI * 2);
        ctx!.fillStyle = color;
        ctx!.fill();

        if (isSelected) {
          ctx!.strokeStyle = isDark ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.8)";
          ctx!.lineWidth = 2.5;
          ctx!.stroke();
        } else if (isHovered) {
          ctx!.strokeStyle = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.5)";
          ctx!.lineWidth = 1.5;
          ctx!.stroke();
        }

        ctx!.shadowColor = "transparent";
        ctx!.shadowBlur = 0;

        // Always show label for selected, show on hover or if node is large
        if (isSelected || isHovered || r > 14) {
          ctx!.globalAlpha = isDimmed ? 0.15 : 1;
          ctx!.font = `${isSelected ? "bold " : ""}11px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx!.textAlign = "center";

          // Background for label
          const label = node.name ?? node.email;
          const tw = ctx!.measureText(label).width;
          ctx!.fillStyle = isDark ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.9)";
          ctx!.fillRect(node.x - tw / 2 - 3, node.y! - r - 18, tw + 6, 14);
          ctx!.fillStyle = getCSSColor("--foreground", isDark ? "#fff" : "#111");
          ctx!.fillText(label, node.x, node.y! - r - 7);
        }

        ctx!.globalAlpha = 1;
      }

      ctx!.restore();
    }

    drawRef.current = draw;
    sim.on("tick", draw);

    // ── Mouse helpers ──
    function canvasToWorld(cx: number, cy: number): [number, number] {
      const { x: tx, y: ty, k } = transformRef.current;
      return [(cx - tx) / k, (cy - ty) / k];
    }

    function getNodeAt(mx: number, my: number): NetNode | null {
      const [wx, wy] = canvasToWorld(mx, my);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.x == null) continue;
        const r = nodeRadius(n) + 4; // extra hit area
        const dx = wx - n.x;
        const dy = wy - (n.y ?? 0);
        if (dx * dx + dy * dy < r * r) return n;
      }
      return null;
    }

    // ── Mouse events ──
    function onMouseMove(e: MouseEvent) {
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;

      // Dragging a node
      if (dragRef.current) {
        const [wx, wy] = canvasToWorld(mx, my);
        dragRef.current.node.fx = wx;
        dragRef.current.node.fy = wy;
        sim.alpha(0.1).restart();
        draw();
        return;
      }

      // Panning
      if (panRef.current) {
        transformRef.current.x = panRef.current.ox + (mx - panRef.current.startX);
        transformRef.current.y = panRef.current.oy + (my - panRef.current.startY);
        draw();
        return;
      }

      const node = getNodeAt(mx, my);
      if (node !== hoveredRef.current) {
        hoveredRef.current = node;
        canvas.style.cursor = node ? "pointer" : "grab";
        draw();
      }
    }

    function onMouseDown(e: MouseEvent) {
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;
      const node = getNodeAt(mx, my);

      if (node) {
        // Start drag
        dragRef.current = { node, offsetX: mx, offsetY: my };
        node.fx = node.x;
        node.fy = node.y;
        canvas.style.cursor = "grabbing";
      } else {
        // Start pan
        panRef.current = {
          startX: mx,
          startY: my,
          ox: transformRef.current.x,
          oy: transformRef.current.y,
        };
        canvas.style.cursor = "grabbing";
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (dragRef.current) {
        const node = dragRef.current.node;
        // Keep node pinned where user dropped it
        dragRef.current = null;
        canvas.style.cursor = "pointer";
        // If barely moved, treat as click (select)
        const cr = canvas.getBoundingClientRect();
        const mx = e.clientX - cr.left;
        const my = e.clientY - cr.top;
        const clickedNode = getNodeAt(mx, my);
        if (clickedNode) {
          selectedRef.current = clickedNode;
          setSelectedNode(clickedNode);
          // Update selected edges
          setSelectedEdges(
            edges.filter((ed) => {
              const s = (ed.source as NetNode).id;
              const t = (ed.target as NetNode).id;
              return s === clickedNode.id || t === clickedNode.id;
            })
          );
        }
        draw();
        return;
      }

      if (panRef.current) {
        const cr = canvas.getBoundingClientRect();
        const mx = e.clientX - cr.left;
        const my = e.clientY - cr.top;
        const moved = Math.abs(mx - panRef.current.startX) + Math.abs(my - panRef.current.startY);
        panRef.current = null;
        canvas.style.cursor = hoveredRef.current ? "pointer" : "grab";

        // If barely moved, treat as click to deselect
        if (moved < 5) {
          const node = getNodeAt(mx, my);
          if (!node) {
            selectedRef.current = null;
            setSelectedNode(null);
            setSelectedEdges([]);
          }
        }
        draw();
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;

      const scaleFactor = e.deltaY > 0 ? 0.92 : 1.08;
      const t = transformRef.current;
      const newK = Math.max(0.2, Math.min(5, t.k * scaleFactor));

      // Zoom towards mouse position
      t.x = mx - (mx - t.x) * (newK / t.k);
      t.y = my - (my - t.y) * (newK / t.k);
      t.k = newK;
      draw();
    }

    function onDblClick(e: MouseEvent) {
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;
      const node = getNodeAt(mx, my);
      if (node) {
        // Unpin double-clicked node
        node.fx = null;
        node.fy = null;
        sim.alpha(0.3).restart();
      }
    }

    // ── Touch events (mobile) ──
    let lastTouchDist = 0;

    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const cr = canvas.getBoundingClientRect();
        const mx = touch.clientX - cr.left;
        const my = touch.clientY - cr.top;
        const node = getNodeAt(mx, my);
        if (node) {
          dragRef.current = { node, offsetX: mx, offsetY: my };
          node.fx = node.x;
          node.fy = node.y;
        } else {
          panRef.current = { startX: mx, startY: my, ox: transformRef.current.x, oy: transformRef.current.y };
        }
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const cr = canvas.getBoundingClientRect();
      if (e.touches.length === 1) {
        const mx = e.touches[0].clientX - cr.left;
        const my = e.touches[0].clientY - cr.top;
        if (dragRef.current) {
          const [wx, wy] = canvasToWorld(mx, my);
          dragRef.current.node.fx = wx;
          dragRef.current.node.fy = wy;
          sim.alpha(0.1).restart();
        } else if (panRef.current) {
          transformRef.current.x = panRef.current.ox + (mx - panRef.current.startX);
          transformRef.current.y = panRef.current.oy + (my - panRef.current.startY);
        }
        draw();
      } else if (e.touches.length === 2 && lastTouchDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - cr.left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - cr.top;
        const scaleFactor = dist / lastTouchDist;
        const t = transformRef.current;
        const newK = Math.max(0.2, Math.min(5, t.k * scaleFactor));
        t.x = midX - (midX - t.x) * (newK / t.k);
        t.y = midY - (midY - t.y) * (newK / t.k);
        t.k = newK;
        lastTouchDist = dist;
        draw();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length === 0) {
        if (dragRef.current) {
          const node = dragRef.current.node;
          dragRef.current = null;
          selectedRef.current = node;
          setSelectedNode(node);
          setSelectedEdges(edges.filter((ed) => {
            const s = (ed.source as NetNode).id;
            const t = (ed.target as NetNode).id;
            return s === node.id || t === node.id;
          }));
          draw();
        }
        if (panRef.current) {
          panRef.current = null;
        }
        lastTouchDist = 0;
      }
    }

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", () => {
      dragRef.current = null;
      panRef.current = null;
    });
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      sim.stop();
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [data]); // Only re-run when data changes, NOT on hover/select

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
            <Button key={n} variant={minEmails === n ? "default" : "outline"} size="sm" onClick={() => setMinEmails(n)}>
              {n}+
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Tipo:</span>
          <Button variant={internalOnly === null ? "default" : "outline"} size="sm" onClick={() => setInternalOnly(null)}>Todos</Button>
          <Button variant={internalOnly === true ? "default" : "outline"} size="sm" onClick={() => setInternalOnly(true)}>Interno</Button>
          <Button variant={internalOnly === false ? "default" : "outline"} size="sm" onClick={() => setInternalOnly(false)}>Externo</Button>
        </div>
      </div>

      {/* Mobile: list view of top connections */}
      <div className="md:hidden space-y-3">
        {data && nodesRef.current
          .sort((a, b) => (b.total_sent + b.total_received) - (a.total_sent + a.total_received))
          .slice(0, 20)
          .map((node) => (
            <Link key={node.id} href={`/contacts/${node.id}`} className="block">
              <Card className="hover:border-primary/30 transition-colors">
                <CardContent className="py-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
                    {node.total_sent + node.total_received}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{node.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{node.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{node.total_sent}↑ {node.total_received}↓</p>
                    {node.company_name && (
                      <Badge variant="outline" className="text-[10px] mt-0.5">{node.company_name}</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
      </div>

      {/* Desktop: Graph + Detail panel */}
      <div className="hidden md:grid gap-6 lg:grid-cols-3">
        {/* Canvas */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-0 overflow-hidden rounded-lg">
              <canvas ref={canvasRef} className="w-full bg-background touch-none" />
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded bg-info" /> Interno
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded bg-warning" /> Externo
            </span>
            <span><GripHorizontal className="inline h-3 w-3" /> Arrastra nodos</span>
            <span>Scroll = zoom</span>
            <span>Doble clic = soltar nodo</span>
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
                  {selectedNode.company_name && <Badge variant="outline">{selectedNode.company_name}</Badge>}
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
                            {edge.is_bidirectional && <Zap className="h-3 w-3 text-warning" />}
                          </div>
                        );
                      })}
                  </div>
                </div>

                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/contacts/${selectedNode.id}`}>Ver perfil completo</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Maximize2 className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  Haz clic en un nodo para ver detalles
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Arrastra para mover nodos, scroll para zoom
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
