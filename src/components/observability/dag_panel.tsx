/**
 * DagPanel — vertical DAG visualization of the workflow phases.
 *
 * Uses @xyflow/react to render a top-to-bottom directed graph with
 * status-styled nodes. Clicking a node selects that phase in the
 * detail panel.
 */

import { useMemo, useCallback } from 'react';
import {
    ReactFlow,
    Background,
    type Node,
    type Edge,
} from '@xyflow/react';

import { DagPhaseNode, type PhaseNodeData } from './dag_phase_node';


// ─── Types ───────────────────────────────────────────────────────────

interface PhaseInfo {
    name: string;
    phase_type: string;
    status: string;
    sequence: number;
    depends_on?: string[];
    max_iterations?: number;
    iteration?: number;
}

interface DagPanelProps {
    phases: PhaseInfo[];
    selected_phase: string | null;
    on_phase_select: (name: string | null) => void;
}


// ─── Layout constants ────────────────────────────────────────────────

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;
const VERTICAL_GAP = 40;
const HORIZONTAL_GAP = 40;
const START_X = 40;
const START_Y = 30;

/** Custom node type registration for xyflow. */
const node_types = { phase: DagPhaseNode };


// ─── Status → style mapping ─────────────────────────────────────────

function status_style(status: string): { bg: string; border: string; text: string } {
    if (status === 'running') return { bg: 'bg-sky-50', border: 'border-sky-400', text: 'text-sky-700' };
    if (status === 'completed') return { bg: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-700' };
    if (status === 'failed' || status === 'crashed') return { bg: 'bg-rose-50', border: 'border-rose-400', text: 'text-rose-700' };
    if (status === 'awaiting_input') return { bg: 'bg-purple-50', border: 'border-purple-400', text: 'text-purple-700' };
    if (status === 'gate_rework') return { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700' };
    // pending / unknown
    return { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-500' };
}


// ─── Component ───────────────────────────────────────────────────────

export function DagPanel({ phases, selected_phase, on_phase_select }: DagPanelProps) {
    /** Build xyflow nodes and edges from the phase list. */
    const { nodes, edges } = useMemo(() => {
        if (phases.length === 0) return { nodes: [], edges: [] };
        return layout_dag(phases, selected_phase);
    }, [phases, selected_phase]);

    const on_node_click = useCallback(
        (_event: React.MouseEvent, node: Node) => {
            on_phase_select(node.id);
        },
        [on_phase_select],
    );

    return (
        <div className="h-full w-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={node_types}
                onNodeClick={on_node_click}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag={true}
                zoomOnScroll={true}
                minZoom={0.5}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#e2e8f0" gap={20} />
            </ReactFlow>
        </div>
    );
}


// ─── Simple top-to-bottom layout ─────────────────────────────────────

/**
 * Assigns x/y positions to nodes in a simple top-to-bottom layout.
 * Phases without dependencies start at the top. Each subsequent layer
 * contains phases whose dependencies are all in prior layers.
 */
function layout_dag(
    phases: PhaseInfo[],
    selected_phase: string | null,
): { nodes: Node<PhaseNodeData>[]; edges: Edge[] } {
    // Build dependency graph.
    const phase_map = new Map(phases.map((p) => [p.name, p]));
    const layers: string[][] = [];
    const placed = new Set<string>();

    // Assign layers via topological ordering.
    let remaining = [...phases];
    while (remaining.length > 0) {
        const layer: string[] = [];
        for (const p of remaining) {
            const deps = p.depends_on ?? [];
            if (deps.every((d) => placed.has(d))) {
                layer.push(p.name);
            }
        }
        if (layer.length === 0) {
            // Cycle or missing deps — dump everything remaining.
            layer.push(...remaining.map((p) => p.name));
        }
        layers.push(layer);
        for (const name of layer) placed.add(name);
        remaining = remaining.filter((p) => !placed.has(p.name));
    }

    // Position nodes.
    const nodes: Node<PhaseNodeData>[] = [];
    let y = START_Y;

    for (const layer of layers) {
        const total_width = layer.length * NODE_WIDTH + (layer.length - 1) * HORIZONTAL_GAP;
        let x = START_X + Math.max(0, (NODE_WIDTH * 2 - total_width) / 2);

        for (const name of layer) {
            const phase = phase_map.get(name)!;
            const style = status_style(phase.status);
            nodes.push({
                id: name,
                type: 'phase',
                position: { x, y },
                data: {
                    label: name,
                    phase_type: phase.phase_type,
                    status: phase.status,
                    style,
                    is_selected: name === selected_phase,
                    max_iterations: phase.max_iterations,
                    iteration: phase.iteration,
                },
            });
            x += NODE_WIDTH + HORIZONTAL_GAP;
        }
        y += NODE_HEIGHT + VERTICAL_GAP;
    }

    // Build edges.
    const edges: Edge[] = [];
    for (const phase of phases) {
        for (const dep of (phase.depends_on ?? [])) {
            /** An arrow is active only when its target phase is the one currently executing. */
            const target_status = phase.status;
            const is_active = target_status === 'running' || target_status === 'awaiting_input';
            edges.push({
                id: `${dep}->${phase.name}`,
                source: dep,
                target: phase.name,
                animated: is_active,
                style: { stroke: is_active ? '#3b82f6' : '#94a3b8', strokeWidth: is_active ? 2 : 1.5 },
            });
        }
    }

    return { nodes, edges };
}
