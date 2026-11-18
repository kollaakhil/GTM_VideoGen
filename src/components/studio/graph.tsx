"use client";

import { useMemo } from "react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import { ImageIcon, Lightbulb, Rocket, Search, Wand2 } from "lucide-react";
import type { Creative, StudioRun } from "@/lib/types";
import { SB_SHIFT, SPINE, DIR_Y, CR_Y, PUB_Y, DIR_X, WORKING } from "./constants";
import { Handles } from "./chrome";
import { BrandNode } from "./brand-node";
import { ResearchNode } from "./research-node";
import { ConceptsNode, StyleNode } from "./concepts-node";
import { BriefNode } from "./brief-node";
import { VideoPlanNode } from "./video-plan-node";
import { DirectionNode } from "./direction-node";
import { CreativeNode } from "./creative-node";
import { OrganicNode, PublishNode } from "./publish-node";

function GhostNode({ data }: NodeProps<Node<{ label: string; step: number; hint: string; icon: keyof typeof GHOST_ICONS; order: number }>>) {
  const Icon = GHOST_ICONS[data.icon];
  return (
    <div className="relative w-[280px] opacity-60 animate-in fade-in duration-700">
      <div className="absolute -top-7 left-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
        {String(data.step).padStart(2, "0")} {data.label}
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-zinc-900/40 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-500">
          <Icon className="size-4" />
        </div>
        <div className="text-[12px] leading-snug text-zinc-500">{data.hint}</div>
      </div>
      <Handles />
    </div>
  );
}

const GHOST_ICONS = { research: Search, brief: Lightbulb, dir: Wand2, creative: ImageIcon, publish: Rocket };

const GHOSTS = [
  { key: "research", step: 2, label: "Research", hint: "Reads your site and maps audience, tone and angles", x: SPINE.research, y: 160, order: 1 },
  { key: "brief", step: 3, label: "Creative brief", hint: "A 20-second brief you can edit and approve", x: SPINE.brief, y: 160, order: 2 },
  { key: "dir", step: 4, label: "Directions", hint: "Three distinct hooks and visual worlds", x: 960, y: DIR_Y, order: 3 },
  { key: "creative", step: 5, label: "Creatives", hint: "Images or video, scored by the Vision QA gate", x: 960, y: CR_Y, order: 4 },
  { key: "publish", step: 6, label: "Gate · Live & learning", hint: "Gate-passed ads go out paused after your approval; results feed the next batch", x: 960, y: PUB_Y, order: 5 },
] as const;

export const nodeTypes = { concepts: ConceptsNode, ghost: GhostNode, style: StyleNode, organic: OrganicNode, videoplan: VideoPlanNode, brand: BrandNode, research: ResearchNode, brief: BriefNode, direction: DirectionNode, creative: CreativeNode, publish: PublishNode };

export function useGraph(run: StudioRun | null, byDir: Record<string, Creative>, dirH = 0) {
  return useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const working = run?.status === "working";
    const sb = Math.max(run?.directions.some((d) => d.shots?.length) ? SB_SHIFT : 0, dirH ? DIR_Y + dirH + 90 - CR_Y : 0);
    let order = 0;
    const edge = (source: string, target: string, down: boolean, opts: { active?: boolean; tone?: "pass" | "fail" } = {}): Edge => ({
      id: `${source}->${target}`,
      source,
      target,
      sourceHandle: down ? "b" : "r",
      targetHandle: down ? "t" : "l",
      animated: !!opts.active,
      style: {
        stroke: opts.active ? "#818cf8" : opts.tone === "pass" ? "#34d399" : opts.tone === "fail" ? "#f87171" : "#52525b",
        strokeWidth: opts.active ? 2 : 1.5,
        strokeDasharray: opts.tone === "fail" ? "5 5" : undefined,
      },
    });
    const withGhosts = () => {
      let sources = nodes.filter((n) => (n.data as { order?: number }).order === order).map((n) => n.id);
      for (const g of GHOSTS) {
        if (g.order <= order) continue;
        const id = `ghost-${g.key}`;
        nodes.push({
          id, type: "ghost", position: { x: g.x, y: g.y + (g.order >= 4 ? sb : 0) },
          focusable: false, style: { pointerEvents: "none" },
          data: { label: g.label, step: g.step, hint: g.hint, icon: g.key, order: g.order },
        });
        sources.forEach((src) => edges.push({ ...edge(src, id, g.order >= 3), animated: false, style: { stroke: "#3f3f46", strokeWidth: 1.5, strokeDasharray: "4 6" } }));
        sources = [id];
      }
      return { nodes, edges };
    };

    nodes.push({ id: "brand", type: "brand", position: { x: SPINE.brand, y: 0 }, data: { order: 0 } });
    if (!run) return withGhosts();

    nodes.push({ id: "research", type: "research", position: { x: SPINE.research, y: 0 }, data: { order: 1 } });
    edges.push(edge("brand", "research", false, { active: working && run.stage === "research" }));
    order = 1;
    if (run.referenceUrl) {
      nodes.push({ id: "style", type: "style", position: { x: SPINE.research, y: -900 }, data: {} });
      edges.push(edge("brand", "style", false, { active: working && run.stage === "research" }));
    }

    if (run.brief || (run.stage === "brief" && run.status !== "idle")) {
      nodes.push({ id: "brief", type: "brief", position: { x: SPINE.brief, y: 0 }, data: { order: 2 } });
      edges.push(edge("research", "brief", false, { active: working && run.stage === "brief" }));
      if (run.referenceUrl) edges.push(edge("style", "brief", false, { active: working && run.stage === "brief" }));
      order = 2;
    }

    const hasConcepts = !!run.concepts?.length;
    if (hasConcepts) {
      nodes.push({ id: "concepts", type: "concepts", position: { x: SPINE.brief + 460, y: 0 }, data: { order: 3 } });
      edges.push(edge("brief", "concepts", false, { active: working && run.stage === "directions" && !run.directions.length }));
    }
    if (run.directions.length > 0 || (run.stage === "directions" && run.status !== "idle" && hasConcepts)) {
      const n = Math.max(1, Math.min(3, run.directions.length || 3));
      Array.from({ length: n }, (_, i) => i).forEach((i) => {
        nodes.push({ id: `dir-${i}`, type: "direction", position: { x: DIR_X[i], y: DIR_Y }, data: { index: i, order: 3 } });
        edges.push(edge(hasConcepts ? "concepts" : "brief", `dir-${i}`, true, { active: working && run.stage === "directions" }));
      });
      order = 3;
    }

    if (run.format === "video" && run.directions.length > 0) {
      nodes.push({ id: "videoplan", type: "videoplan", position: { x: 140, y: DIR_Y }, data: {} });
      edges.push(edge("brief", "videoplan", true, {}));
    }
    let anyCreative = false;
    run.directions.forEach((d, i) => {
      const c = byDir[d.id];
      const p = run.progress[d.id];
      if (!c && !p) return;
      anyCreative = true;
      nodes.push({ id: `cr-${i}`, type: "creative", position: { x: DIR_X[i] + 20, y: CR_Y + sb }, data: { index: i, order: 4 } });
      edges.push(edge(`dir-${i}`, `cr-${i}`, true, { active: !!p && WORKING.includes(p) }));
    });
    if (anyCreative) order = 4;

    if (run.stage === "qa" || run.stage === "publish") {
      nodes.push({ id: "publish", type: "publish", position: { x: 950, y: PUB_Y + sb }, data: { order: 5 } });
      if (run.organic) {
        nodes.push({ id: "organic", type: "organic", position: { x: 1340, y: PUB_Y + sb }, data: {} });
        edges.push(edge("publish", "organic", false, {}));
      }
      run.directions.forEach((d, i) => {
        const c = byDir[d.id];
        if (c) edges.push(edge(`cr-${i}`, "publish", true, { tone: c.qa?.pass ? "pass" : "fail" }));
      });
      order = 5;
    }
    return withGhosts();
  }, [run, byDir, dirH]);
}
