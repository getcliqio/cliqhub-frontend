/**
 * DagPhaseNode — custom @xyflow/react node for a workflow phase.
 *
 * Displays the phase name, type badge, status styling, and
 * iteration badge for gate phases.
 */

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';


// ─── Types ───────────────────────────────────────────────────────────

export interface PhaseNodeData {
    label: string;
    phase_type: string;
    status: string;
    style: { bg: string; border: string; text: string };
    is_selected: boolean;
    max_iterations?: number;
    iteration?: number;
    [key: string]: unknown;
}


// ─── Component ───────────────────────────────────────────────────────

function DagPhaseNodeComponent({ data }: { data: PhaseNodeData }) {
    const { label, phase_type, status, style, is_selected, max_iterations, iteration } = data;
    const is_gate = phase_type === 'gate';
    const is_running = status === 'running';

    return (
        <div
            className={[
                'min-w-[160px] rounded-lg border-2 px-3 py-2 shadow-sm transition-all',
                style.bg,
                is_selected ? 'border-indigo-500 ring-2 ring-indigo-200' : style.border,
                is_running ? 'animate-pulse' : '',
            ].join(' ')}
        >
            <Handle type="target" position={Position.Top} className="!bg-slate-400" />

            <div className="flex items-center justify-between gap-2">
                <span className={`font-mono text-xs font-bold ${style.text}`}>
                    {label}
                </span>

                {is_gate && max_iterations && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        {status === 'completed' ? '✓' : ''} {iteration ?? 0}/{max_iterations}
                    </span>
                )}
            </div>

            <div className="mt-1 flex items-center gap-1.5">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${_type_badge(phase_type)}`}>
                    {phase_type}
                </span>
                <span className={`text-[10px] ${style.text}`}>
                    {_status_label(status)}
                </span>
            </div>

            <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
        </div>
    );
}

export const DagPhaseNode = memo(DagPhaseNodeComponent);


// ─── Helpers ─────────────────────────────────────────────────────────

function _type_badge(phase_type: string): string {
    if (phase_type === 'gate') return 'bg-amber-100 text-amber-700';
    if (phase_type === 'team') return 'bg-blue-100 text-blue-700';
    return 'bg-slate-100 text-slate-600';
}

function _status_label(status: string): string {
    if (status === 'running') return '● running';
    if (status === 'completed') return '✓ done';
    if (status === 'failed' || status === 'crashed') return '✕ failed';
    if (status === 'awaiting_input') return '⏸ input';
    if (status === 'gate_rework') return '↻ rework';
    return '○ pending';
}
