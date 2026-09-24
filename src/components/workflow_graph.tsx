import { useState } from 'react';
import type { WorkflowPhase, AgentDef } from '@/lib/types';

const PHASE_STYLES: Record<string, { bg: string; border: string; badge: string; label: string }> = {
	standard:   { bg: 'bg-white',      border: 'border-slate-300', badge: 'bg-slate-100 text-slate-600',   label: 'standard' },
	gate:       { bg: 'bg-amber-50',   border: 'border-amber-300', badge: 'bg-amber-100 text-amber-700',   label: 'gate' },
	team:       { bg: 'bg-blue-50',    border: 'border-blue-300',  badge: 'bg-blue-100 text-blue-700',     label: 'team' },
};

function assign_columns(phases: WorkflowPhase[]): Map<string, { col: number; row: number }> {
	const positions = new Map<string, { col: number; row: number }>();
	const phase_map = new Map(phases.map((p) => [p.name, p]));

	const placed = new Set<string>();
	let row = 0;

	const roots = phases.filter((p) => !p.depends_on?.length && !p.is_support);
	const support = phases.filter((p) => p.is_support);

	function place_layer(names: string[]) {
		if (names.length === 0) return;

		names.forEach((name, i) => {
			positions.set(name, { col: i, row });
			placed.add(name);
		});
		row++;

		const next_layer: string[] = [];
		for (const p of phases) {
			if (placed.has(p.name) || p.is_support) continue;
			if (p.depends_on?.every((d) => placed.has(d))) {
				next_layer.push(p.name);
			}
		}
		place_layer(next_layer);
	}

	place_layer(roots.map((r) => r.name));

	for (const p of phases) {
		if (!placed.has(p.name) && !p.is_support) {
			positions.set(p.name, { col: 0, row: row++ });
		}
	}

	support.forEach((p, i) => {
		positions.set(p.name, { col: -1, row: i });
	});

	return positions;
}

export function WorkflowGraph({ phases, agents }: { phases: WorkflowPhase[]; agents?: Record<string, AgentDef> }) {
	const [expanded, setExpanded] = useState<string | null>(null);

	if (!phases || phases.length === 0) return null;

	const positions = assign_columns(phases);
	const main_phases = phases.filter((p) => !p.is_support);
	const support_phases = phases.filter((p) => p.is_support);

	const rows: WorkflowPhase[][] = [];
	for (const p of main_phases) {
		const pos = positions.get(p.name);
		if (!pos) continue;
		if (!rows[pos.row]) rows[pos.row] = [];
		rows[pos.row].push(p);
	}

	return (
		<div className="space-y-3">
			{rows.map((row_phases, row_idx) => (
				<div key={row_idx}>
					{/* Connector arrow between rows */}
					{row_idx > 0 && (
						<div className="flex justify-center py-1">
							<svg width="20" height="20" viewBox="0 0 20 20" className="text-slate-300">
								<path d="M10 0 L10 14 M5 10 L10 16 L15 10" fill="none" stroke="currentColor" strokeWidth="2" />
							</svg>
						</div>
					)}

					<div className="flex items-start justify-center gap-4">
						{row_phases.map((phase) => {
							const style = PHASE_STYLES[phase.type || 'standard'] || PHASE_STYLES.standard;
							const is_expanded = expanded === phase.name;

							return (
								<button
									key={phase.name}
									onClick={() => setExpanded(is_expanded ? null : phase.name)}
									className={`min-w-[180px] max-w-[260px] rounded-lg border-2 ${style.border} ${style.bg} p-4 text-left transition hover:shadow-md`}
								>
									<div className="mb-1 flex items-center gap-2">
										<span className="font-mono text-sm font-bold">{phase.name}</span>
										<span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${style.badge}`}>
											{style.label}
										</span>
									</div>

									{phase.agent && (
										<p className="mb-1 flex items-center gap-1 text-[10px] text-purple-600">
											<svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
												<path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
											</svg>
										<span className="font-semibold">{phase.agent}</span>
										</p>
									)}

									{phase.max_iterations && (
										<p className="text-xs text-slate-400">max {phase.max_iterations} iterations</p>
									)}

								{is_expanded && phase.commands && phase.commands.length > 0 && (
									<div className="mt-3 space-y-1 border-t border-slate-200 pt-2">
										<p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Commands</p>
										{phase.commands.map((cmd) => (
											<div key={cmd.name} className="rounded bg-slate-100 px-2 py-1">
												<span className="font-mono text-xs">{cmd.name}</span>
												<p className="truncate font-mono text-[10px] text-slate-400">{cmd.run}</p>
												</div>
											))}
										</div>
									)}

								{phase.commands && phase.commands.length > 0 && !is_expanded && (
									<p className="mt-1 text-[10px] text-slate-400">{phase.commands.length} command{phase.commands.length > 1 ? 's' : ''} — click to expand</p>
									)}

								{is_expanded && phase.sources && phase.sources.length > 0 && (
									<div className="mt-3 space-y-1 border-t border-sky-200 pt-2">
										<p className="text-[10px] font-semibold uppercase tracking-wide text-sky-500">Sources</p>
										{phase.sources.map((entry) => (
											<div key={entry.name} className="rounded bg-sky-50 px-2 py-1">
												<span className="font-mono text-xs font-semibold text-slate-800">{entry.name}</span>
												{entry.url && <p className="truncate font-mono text-[10px] text-slate-400">{entry.url}</p>}
												{entry.ref && <p className="truncate font-mono text-[10px] text-slate-400">ref: {entry.ref}</p>}
											</div>
										))}
									</div>
								)}

								{is_expanded && phase.target_entries && phase.target_entries.length > 0 && (
									<div className="mt-3 space-y-1 border-t border-teal-200 pt-2">
										<p className="text-[10px] font-semibold uppercase tracking-wide text-teal-500">Targets</p>
										{phase.target_entries.map((entry, idx) => (
											<div key={idx} className="rounded bg-teal-50 px-2 py-1">
												<div className="flex items-center gap-1.5">
													<span className="font-mono text-xs font-semibold text-slate-800">{entry.name}</span>
													{entry.mode && entry.mode !== 'create' && (
														<span className="rounded bg-slate-200 px-1 py-px text-[9px] font-semibold text-slate-600">{entry.mode}</span>
													)}
												</div>
												<p className="truncate font-mono text-[10px] text-slate-400">{entry.file}</p>
											</div>
										))}
									</div>
								)}

								{is_expanded && phase.review?.reviewer && (
								<div className="mt-3 space-y-1 border-t border-violet-200 pt-2">
									<p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">Review</p>
									<div className="rounded bg-violet-50 px-2 py-1 space-y-0.5">
										<p className="text-xs text-slate-700">
											<span className="font-semibold">Reviewer:</span>{' '}
											{Array.isArray(phase.review.reviewer) ? phase.review.reviewer.join(', ') : phase.review.reviewer}
										</p>
										{phase.review.artifacts && phase.review.artifacts.length > 0 && (
											<p className="text-xs text-slate-700">
												<span className="font-semibold">Artifacts:</span>{' '}
												{phase.review.artifacts.join(', ')}
											</p>
										)}
										{phase.review.timeout && (
											<p className="text-xs text-slate-500">Timeout: {phase.review.timeout}</p>
										)}
										{phase.review.remind_every && (
											<p className="text-xs text-slate-500">Remind every: {phase.review.remind_every}</p>
										)}
									</div>
								</div>
							)}

							{!is_expanded && phase.review?.reviewer && (
								<p className="mt-1 text-[10px] text-violet-500">
									reviewer: {Array.isArray(phase.review.reviewer) ? phase.review.reviewer.join(', ') : phase.review.reviewer}
									{' — click to expand'}
								</p>
							)}

							{!is_expanded && (phase.sources?.length || phase.target_entries?.length) ? (
									<div className="mt-1.5 flex items-center gap-1.5">
										{phase.sources && phase.sources.length > 0 && (
											<span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
												{phase.sources.length} sources
											</span>
										)}
										{phase.target_entries && phase.target_entries.length > 0 && (
											<span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">
												{phase.target_entries.length} targets
											</span>
										)}
									</div>
								) : null}
								</button>
							);
						})}
					</div>
				</div>
			))}

			{/* Support phases */}
			{support_phases.length > 0 && (
				<div className="mt-4 border-t border-dashed border-slate-200 pt-4">
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Support agents</p>
					<div className="flex flex-wrap gap-3">
						{support_phases.map((phase) => {
							const style = PHASE_STYLES[phase.type || 'standard'] || PHASE_STYLES.standard;
							return (
								<div
									key={phase.name}
									className={`rounded-lg border-2 ${style.border} ${style.bg} px-4 py-3`}
								>
									<div className="flex items-center gap-2">
										<span className="font-mono text-sm font-bold">{phase.name}</span>
										<span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${style.badge}`}>
											{phase.type ?? style.label} (support)
										</span>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
