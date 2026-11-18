"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow, useReactFlow, type NodeChange } from "@xyflow/react";
import { useFlow } from "./context";
import { noop } from "./utils";
import { nodeTypes, useGraph } from "./graph";
import { Dock } from "./dock";

export function Canvas({ elapsed, notice }: { elapsed: number; notice: string | null }) {
  const { run, byDir } = useFlow();
  const [dirHs, setDirHs] = useState<Record<string, number>>({});
  const dirH = Math.round(Math.max(0, ...Object.values(dirHs)) / 40) * 40;
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const next: Record<string, number> = {};
    for (const c of changes) if (c.type === "dimensions" && c.dimensions && c.id.startsWith("dir-")) next[c.id] = c.dimensions.height;
    if (Object.keys(next).length) setDirHs((h) => ({ ...h, ...next }));
  }, []);
  const { nodes, edges } = useGraph(run, byDir, dirH);
  const flow = useReactFlow();
  const seen = useRef<string>("");

  useEffect(() => {
    const ids = nodes.filter((n) => n.type !== "ghost").map((n) => n.id);
    const key = ids.join(",");
    if (key === seen.current) return;
    const prev = new Set(seen.current ? seen.current.split(",") : []);
    seen.current = key;
    const fresh = ids.filter((id) => !prev.has(id));
    const focus = prev.size > 0 && fresh.length ? fresh : ids.length === 1 ? ["brand"] : ids.slice(-3);
    // Not cleared on re-render: polling recreates `nodes`, which would otherwise cancel the pending fit.
    const fit = () => flow.fitView({ nodes: focus.map((id) => ({ id })), padding: 0.15, maxZoom: 1, minZoom: 0.45, duration: prev.size ? 700 : 0 });
    setTimeout(fit, 250);
  }, [nodes, flow]);

  return (
    <div className="relative min-h-0 flex-1 bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={noop}
        panOnScroll
        minZoom={0.2}
        maxZoom={1.5}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#27272a" />
        <Controls showInteractive={false} position="bottom-left" className="!overflow-hidden !rounded-xl !border !border-white/10 !shadow-none" />
      </ReactFlow>
      <Dock elapsed={elapsed} notice={notice} />
    </div>
  );
}
