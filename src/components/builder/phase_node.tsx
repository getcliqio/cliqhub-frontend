import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useBuilder, useBuilderDispatch } from '@/lib/builder/store';

const STYLES: Record<string, { bg: string; border: string; badge: string; selected_border: string }> = {
	standard:   { bg: 'bg-white',       border: 'border-slate-300', badge: 'bg-slate-100 text-slate-600', selected_border: 'border-indigo-500' },
	gate:       { bg: 'bg-amber-50',    border: 'border-amber-300', badge: 'bg-amber-100 text-amber-700', selected_border: 'border-amber-500' },
	team:       { bg: 'bg-blue-50',     border: 'border-blue-300',  badge: 'bg-blue-100 text-blue-700', selected_border: 'border-blue-500' },
};

interface PhaseNodeData {
	label: string;
	phase_type: string;
	commands_count: number;
	max_iterations?: number;
	agent?: string;
	sources_count: number;
	targets_count: number;
	pending?: boolean;
	[key: string]: unknown;
}

function PhaseNodeComponent({ data }: { data: PhaseNodeData }) {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const style = STYLES[data.phase_type] || STYLES.standard;
	const is_selected = state.selected_phase === data.label;
	const is_pending = !!data.pending;

	return (
		<div
			onClick={() => dispatch({ type: 'SELECT_PHASE', name: data.label })}
			className={`min-w-[160px] cursor-pointer rounded-lg border-2 ${is_pending ? 'border-dashed' : ''} ${is_selected ? style.selected_border : style.border} ${is_pending ? 'bg-amber-50/60 opacity-75' : style.bg} px-4 py-3 shadow-sm transition-colors ${is_selected ? 'ring-2 ring-indigo-200' : ''}`}
		>
			<Handle type="target" position={Position.Top} className="!bg-slate-400" />

			<div className="flex items-center justify-between gap-2">
				<span className={`font-mono text-sm font-bold ${is_pending ? 'text-amber-800' : 'text-slate-900'}`}>
					{data.label}
				</span>
				<button
					onClick={(e) => {
						e.stopPropagation();
						dispatch({ type: 'REMOVE_PHASE', name: data.label });
					}}
					className="text-xs text-slate-400 hover:text-red-500"
					title="Remove phase"
				>
					✕
				</button>
			</div>

		<div className="mt-1 flex items-center gap-2">
			<span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${style.badge}`}>
				{data.phase_type}
			</span>
			{is_pending && (
				<span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
					pending
				</span>
			)}
			{data.commands_count > 0 && (
				<span className="text-xs text-slate-500">{data.commands_count} cmds</span>
				)}
				{data.max_iterations && (
					<span className="text-xs text-slate-500">max {data.max_iterations}x</span>
				)}
			</div>
			{data.agent && (
				<div className="mt-1.5 flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5">
					<span className="text-xs font-semibold text-purple-700">{data.agent}</span>
				</div>
			)}
			{(data.sources_count > 0 || data.targets_count > 0) && (
				<div className="mt-1.5 flex items-center gap-1.5">
					{data.sources_count > 0 && (
						<span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
							{data.sources_count} sources
						</span>
					)}
					{data.targets_count > 0 && (
						<span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">
							{data.targets_count} targets
						</span>
					)}
				</div>
			)}

			<Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
		</div>
	);
}

export const PhaseNode = memo(PhaseNodeComponent);
