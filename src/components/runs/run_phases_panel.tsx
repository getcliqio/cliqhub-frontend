import { useId } from 'react';

export interface Prior_attempt {
	attempt: number;
	status: string;
	dispatched_at: number | null;
	started_at: number | null;
	completed_at: number | null;
	exit_code: number | null;
	error: string | null;
}

export interface Run_phase_row {
	phase: string;
	status: string;
	agent_name?: string | null;
	/** Workflow order from Hub (0-based). Prefer over phase name. */
	sequence?: number | null;
	dispatched_at?: number | null;
	started_at?: number | null;
	completed_at?: number | null;
	exit_code?: number | null;
	error?: string | null;
	attempt?: number | null;
	/**
	 * Snapshotted timing from earlier attempts of this phase — populated
	 * by the Hub whenever `update_phase_status` fires with a new run
	 * attempt or `reset_phase` clears the current attempt. Newest at
	 * the tail. Empty array (never null) when the phase has only run
	 * once.
	 */
	previous_attempts?: Prior_attempt[] | null;
}

/** Sort phases in workflow order — never alphabetical by name. */
export function sort_phases_workflow(phases: readonly Run_phase_row[]): Run_phase_row[] {
	return [...phases].sort((a, b) => {
		const seq_a = a.sequence;
		const seq_b = b.sequence;
		const has_seq =
			typeof seq_a === 'number' &&
			typeof seq_b === 'number' &&
			!(seq_a === 0 && seq_b === 0 && phases.length > 1 && phases.every((p) => (p.sequence ?? 0) === 0));
		if (has_seq && seq_a !== seq_b) return (seq_a as number) - (seq_b as number);

		const t_a = a.started_at ?? a.dispatched_at ?? a.completed_at ?? Number.MAX_SAFE_INTEGER;
		const t_b = b.started_at ?? b.dispatched_at ?? b.completed_at ?? Number.MAX_SAFE_INTEGER;
		if (t_a !== t_b) return t_a - t_b;
		return 0;
	});
}

interface Run_phases_panel_props {
	phases: readonly Run_phase_row[];
	loading?: boolean;
	/**
	 * State of the parent run. Controls whether we render an empty-state
	 * hint when there are no phase rows yet (so the user knows the panel
	 * exists and why it's empty), instead of the panel disappearing.
	 */
	run_state?: string;
	/** Currently selected phase for log filtering (phase name). */
	selected_phase?: string | null;
	/** Click a node to filter logs; click again to clear. */
	on_select_phase?: (phase: string | null) => void;
}

type Phase_tone = 'done' | 'running' | 'awaiting' | 'failed' | 'muted' | 'skipped';

function normalize_status(status: string): string {
	const s = (status || '').trim().toLowerCase();
	if (s === 'completed' || s === 'complete' || s === 'success' || s === 'succeeded') return 'done';
	if (s === 'error' || s === 'failure') return 'failed';
	return s;
}

function tone_for(status: string): Phase_tone {
	const s = normalize_status(status);
	if (s === 'done') return 'done';
	if (s === 'running') return 'running';
	if (s === 'awaiting_input') return 'awaiting';
	if (s === 'failed' || s === 'crashed' || s === 'cancelled' || s === 'timed_out') return 'failed';
	if (s === 'skipped') return 'skipped';
	return 'muted';
}

function fill_for(tone: Phase_tone): string {
	if (tone === 'done') return '#059669';
	if (tone === 'running') return '#4f46e5';
	if (tone === 'awaiting') return '#d97706';
	if (tone === 'failed') return '#e11d48';
	if (tone === 'skipped') return '#94a3b8';
	return '#64748b';
}

function short_error(error: string | null | undefined): string | null {
	if (!error) return null;
	const one_line = error.replace(/\s+/g, ' ').trim();
	if (one_line.length <= 18) return one_line;
	return `${one_line.slice(0, 17)}…`;
}

/** Status line under the phase name — never confuse a phase named "done" with success. */
function role_for(row: Run_phase_row): string {
	const s = normalize_status(row.status);
	if (s === 'awaiting_input') return 'needs you';
	if (s === 'running') return row.agent_name ? `running · ${row.agent_name}` : 'running';
	if (s === 'done') return row.agent_name ? `ok · ${row.agent_name}` : 'succeeded';
	if (s === 'crashed') return short_error(row.error) ?? 'crashed';
	if (s === 'failed') return short_error(row.error) ?? 'failed';
	if (s === 'cancelled') return 'cancelled';
	if (s === 'timed_out') return 'timed out';
	if (s === 'skipped') return 'skipped';
	if (row.agent_name) return row.agent_name;
	return s || 'waiting';
}

function format_duration_ms(ms: number): string {
	if (ms < 1_000) return `${ms}ms`;
	const s = ms / 1_000;
	if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
	const m = Math.floor(s / 60);
	const rem = Math.round(s - m * 60);
	if (m < 60) return `${m}m ${rem}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m - h * 60}m`;
}

function phase_duration(row: Run_phase_row): string | null {
	const start = row.started_at ?? row.dispatched_at ?? null;
	if (!start) return null;
	const end = row.completed_at ?? (row.status === 'running' || row.status === 'awaiting_input' ? Date.now() : null);
	if (!end) return null;
	return format_duration_ms(Math.max(0, end - start));
}

/** Duration of a snapshotted prior attempt in ms, or null when unknown. */
function prior_attempt_duration_ms(p: Prior_attempt): number | null {
	const start = p.started_at ?? p.dispatched_at ?? null;
	const end = p.completed_at ?? null;
	if (start == null || end == null) return null;
	return Math.max(0, end - start);
}

/** Short label for a prior attempt row inside the tooltip. */
function format_prior_attempt(p: Prior_attempt): string {
	const dur_ms = prior_attempt_duration_ms(p);
	const dur = dur_ms != null ? format_duration_ms(dur_ms) : '—';
	const status = (p.status ?? 'unknown').trim() || 'unknown';
	return `#${p.attempt}: ${status} (${dur})`;
}

function summarise(phases: readonly Run_phase_row[]): string {
	const counts: Record<string, number> = {};
	for (const p of phases) {
		const s = normalize_status(p.status) || p.status;
		counts[s] = (counts[s] ?? 0) + 1;
	}
	const parts: string[] = [];
	if (counts.awaiting_input) parts.push(`${counts.awaiting_input} need you`);
	if (counts.running) parts.push(`${counts.running} running`);
	if (counts.done) parts.push(`${counts.done} succeeded`);
	const broken = (counts.failed ?? 0) + (counts.crashed ?? 0);
	if (broken) parts.push(`${broken} failed`);
	if (counts.skipped) parts.push(`${counts.skipped} skipped`);
	if (counts.cancelled) parts.push(`${counts.cancelled} cancelled`);
	return `${phases.length} step${phases.length === 1 ? '' : 's'}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
}

function headline_for(phases: readonly Run_phase_row[], run_state?: string): string {
	if (phases.some((p) => normalize_status(p.status) === 'awaiting_input')) return 'Needs you to continue';
	if (phases.some((p) => normalize_status(p.status) === 'crashed') || run_state === 'crashed') {
		return 'This run crashed';
	}
	if (phases.some((p) => normalize_status(p.status) === 'failed') || run_state === 'failed') {
		return 'This run failed';
	}
	if (run_state === 'cancelled' || phases.some((p) => normalize_status(p.status) === 'cancelled')) {
		return 'This run was cancelled';
	}
	if (phases.some((p) => normalize_status(p.status) === 'running') || run_state === 'running') {
		return 'How this run is finishing';
	}
	if (run_state === 'completed' || run_state === 'done') return 'This run finished';
	return 'How this run is finishing';
}

/**
 * Live phase story graph for a run — same energy as the login marketing
 * pipeline, driven by real Hub phase rows.
 */
export function Run_phases_panel({
	phases: phases_raw,
	loading,
	run_state,
	selected_phase = null,
	on_select_phase,
}: Run_phases_panel_props) {
	const grad_id = useId().replace(/:/g, '');
	const arrow_id = `${grad_id}_arrow`;
	const phases = sort_phases_workflow(phases_raw);

	const empty = phases.length === 0;
	const node_w = 118;
	const node_h = 56;
	const gap = 36;
	const pad_x = 12;
	const pad_y = 28;
	const layout_nodes = phases.map((row, i) => {
		let status = normalize_status(row.status);
		// Only the in-flight step becomes crashed/failed when the run dies.
		// Pending/ready steps never started — keep them muted, not red.
		if ((run_state === 'crashed' || run_state === 'failed') && status === 'running') {
			status = run_state === 'crashed' ? 'crashed' : 'failed';
		}
		if (
			(run_state === 'crashed' || run_state === 'failed' || run_state === 'cancelled') &&
			(status === 'ready' || status === 'pending')
		) {
			status = 'skipped';
		}
		return {
			row: status === normalize_status(row.status) ? row : { ...row, status },
			tone: tone_for(status),
			x: pad_x + i * (node_w + gap),
			y: pad_y,
			w: node_w,
			h: node_h,
		};
	});
	const layout_width = pad_x * 2 + phases.length * node_w + Math.max(0, phases.length - 1) * gap;
	const layout_height = pad_y * 2 + node_h;

	if (empty && run_state === 'queued') return null;
	if (empty && loading) return null;

	const summary = empty ? 'No phase records for this run on Hub yet.' : summarise(phases);
	const needs_you = phases.some((p) => normalize_status(p.status) === 'awaiting_input');
	const is_broken =
		run_state === 'failed' ||
		run_state === 'crashed' ||
		phases.some((p) => {
			const s = normalize_status(p.status);
			return s === 'failed' || s === 'crashed';
		});
	const headline = empty ? 'Phases' : headline_for(phases, run_state);
	const pulse_class = needs_you
		? 'bg-amber-500'
		: is_broken
			? 'bg-rose-500'
			: 'bg-emerald-500';
	const clickable = typeof on_select_phase === 'function';

	return (
		<section
			aria-label="Run progress"
			className="rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900"
		>
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
				<div>
					<p className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] ${
						is_broken && !needs_you
							? 'text-rose-600 dark:text-rose-300'
							: 'text-indigo-600 dark:text-indigo-300'
					}`}>
						<span className={`inline-block h-1.5 w-1.5 animate-pulse rounded-full ${pulse_class}`} />
						{headline}
					</p>
					<p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
						{summary}
						{!empty && clickable ? ' · click a step to filter logs' : ''}
						{selected_phase ? (
							<>
								{' · '}
								<span className="font-semibold text-indigo-700 dark:text-indigo-300">
									logs: {selected_phase}
								</span>
								{clickable ? (
									<button
										type="button"
										className="ml-1 font-semibold text-slate-500 underline-offset-2 hover:underline"
										onClick={() => on_select_phase?.(null)}
									>
										clear
									</button>
								) : null}
							</>
						) : null}
					</p>
				</div>
			</header>

			{empty ? (
				<div className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
					<p>
						Phases haven&apos;t been mirrored from the daemon yet. New runs
						populate automatically; older runs land on the next daemon
						restart (one-shot backfill).
					</p>
				</div>
			) : (
				<div className="overflow-x-auto px-2 py-3">
					<svg
						viewBox={`0 0 ${layout_width} ${layout_height}`}
						className="mx-auto block h-auto w-full"
						style={{ minWidth: Math.min(layout_width, 720), maxWidth: layout_width }}
						role="img"
						aria-label="Run phase progress"
					>
						<defs>
							<linearGradient id={grad_id} x1="0%" y1="0%" x2="100%" y2="0%">
								<stop offset="0%" stopColor="#6366f1" />
								<stop offset="100%" stopColor="#a855f7" />
							</linearGradient>
							<marker
								id={arrow_id}
								viewBox="0 0 10 10"
								refX="9"
								refY="5"
								markerWidth="5.5"
								markerHeight="5.5"
								orient="auto"
							>
								<path d="M0,0 L10,5 L0,10 z" fill="#a855f7" />
							</marker>
						</defs>

						{layout_nodes.slice(0, -1).map((a, i) => {
							const b = layout_nodes[i + 1];
							const x1 = a.x + a.w;
							const y1 = a.y + a.h / 2;
							const x2 = b.x;
							const y2 = b.y + b.h / 2;
							const cx = (x1 + x2) / 2;
							const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
							const broken_edge = a.tone === 'failed' || b.tone === 'failed';
							const live_b = b.tone === 'running' || b.tone === 'awaiting';
							/** Arrow is active only when its destination is the currently executing phase. */
							const active =
								!broken_edge && (live_b || (a.tone === 'done' && b.tone === 'muted'));
							return (
								<g key={`e-${i}`}>
									<path
										d={d}
										stroke={broken_edge ? '#fb7185' : active ? `url(#${grad_id})` : '#cbd5e1'}
										strokeWidth="2"
										fill="none"
										markerEnd={`url(#${arrow_id})`}
										opacity={broken_edge || active ? 0.9 : 0.55}
									/>
									{active ? (
										<circle r="3.25" fill="#a855f7">
											<animateMotion
												dur="2.4s"
												repeatCount="indefinite"
												begin={`${0.25 * i}s`}
												path={d}
											/>
											<animate
												attributeName="opacity"
												values="0;1;1;0"
												keyTimes="0;0.12;0.88;1"
												dur="2.4s"
												repeatCount="indefinite"
												begin={`${0.25 * i}s`}
											/>
										</circle>
									) : null}
								</g>
							);
						})}

						{layout_nodes.map(({ row, tone, x, y, w, h }, idx) => {
							const duration = phase_duration(row);
							const prior_attempts = Array.isArray(row.previous_attempts) ? row.previous_attempts : [];
							// `attempt` field on the row is the CURRENT attempt
							// count. If the daemon isn't bumping it (older
							// daemons), fall back to length of prior_attempts+1
							// so multi-attempt phases still show ×N in the UI.
							const attempt_count = Math.max(row.attempt ?? 1, prior_attempts.length + 1);
							const hero = tone === 'awaiting' || tone === 'running' || tone === 'failed';
							const muted_future = tone === 'muted' || tone === 'skipped';
							const role = role_for(row);
							const selected = selected_phase === row.phase;
							const ring =
								tone === 'awaiting' ? '#fbbf24' : tone === 'failed' ? '#fb7185' : '#818cf8';
							function handle_activate() {
								if (!clickable) return;
								on_select_phase?.(selected ? null : row.phase);
							}
							return (
								<g
									key={`${row.phase}-${idx}`}
									opacity={muted_future && !selected ? 0.55 : 1}
									role={clickable ? 'button' : undefined}
									tabIndex={clickable ? 0 : undefined}
									aria-pressed={clickable ? selected : undefined}
									aria-label={
										clickable
											? `${row.phase}, ${role}. Click to ${selected ? 'clear' : 'filter'} logs`
											: undefined
									}
									style={clickable ? { cursor: 'pointer' } : undefined}
									onClick={handle_activate}
									onKeyDown={(e) => {
										if (!clickable) return;
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											handle_activate();
										}
									}}
								>
									{selected ? (
										<rect
											x={x - 4}
											y={y - 4}
											width={w + 8}
											height={h + 8}
											rx="15"
											fill="none"
											stroke="#4f46e5"
											strokeWidth="3"
										/>
									) : null}
									{hero && !selected ? (
										<rect
											x={x - 3}
											y={y - 3}
											width={w + 6}
											height={h + 6}
											rx="14"
											fill="none"
											stroke={ring}
											strokeWidth="2"
											opacity="0.7"
										>
											<animate
												attributeName="opacity"
												values="0.35;0.85;0.35"
												dur="2s"
												repeatCount="indefinite"
											/>
										</rect>
									) : null}
									<rect x={x} y={y} width={w} height={h} rx="12" fill={fill_for(tone)} />
									<text
										x={x + w / 2}
										y={y + 22}
										textAnchor="middle"
										fill="#fff"
										style={{ fontSize: '12px', fontWeight: 700 }}
									>
										{row.phase.length > 14 ? `${row.phase.slice(0, 13)}…` : row.phase}
									</text>
									<text
										x={x + w / 2}
										y={y + 38}
										textAnchor="middle"
										fill="rgba(255,255,255,0.8)"
										style={{ fontSize: '9.5px', fontWeight: 500 }}
									>
										{role.length > 18 ? `${role.slice(0, 17)}…` : role}
									</text>
									{attempt_count > 1 ? (
										<g>
											<rect
												x={x + w - 26}
												y={y - 8}
												width="26"
												height="16"
												rx="8"
												fill="#0f172a"
												stroke="#fff"
												strokeWidth="1.25"
											/>
											<text
												x={x + w - 13}
												y={y + 3}
												textAnchor="middle"
												fill="#fff"
												style={{ fontSize: '9px', fontWeight: 700 }}
											>
												×{attempt_count}
											</text>
										</g>
									) : null}
									<title>
										{[
											row.phase,
											`status: ${normalize_status(row.status) || row.status}`,
											role,
											duration ? `this attempt: ${duration}` : null,
											attempt_count > 1 ? `attempt ${attempt_count}` : null,
											prior_attempts.length > 0
												? 'prior attempts:\n  ' + prior_attempts.map(format_prior_attempt).join('\n  ')
												: null,
											row.error,
											clickable ? (selected ? 'click to clear log filter' : 'click to filter logs') : null,
										]
											.filter(Boolean)
											.join(' · ')}
									</title>
								</g>
							);
						})}
					</svg>
				</div>
			)}
		</section>
	);
}
