/**
 * Run page telemetry (Graphite): summary strip, Timeline (waterfall), Usage,
 * DAG and the selected-span details that replace the side column.
 * Data: one `POST /v1/run_telemetry/get` (BFF) passed in as `t`.
 * Span log lines: `POST /v1/runs/get_logs` (single Core read, time-windowed).
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Link } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { relative_time } from '@/lib/overview';
import type { Run_attempt } from '@/lib/realm_inbox';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import {
	KIND_COLOR,
	KIND_LABEL,
	QUEUE_COLOR,
	by_agent_csv,
	critical_path,
	dag_layers,
	fmt_count,
	fmt_ms,
	fmt_units,
	fmt_usd,
	phase_model_costs,
	tick_label,
	tick_step,
	type Agent_kind,
	type Run_telemetry_data,
	type Telemetry_bar,
	type Telemetry_phase,
	type Telemetry_sub_run,
} from '@/lib/run_telemetry';

const CARD = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';
const LBL = 'text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]';
const CHIP = (on: boolean) => `inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const TH = 'px-4 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]';
const HATCH = 'repeating-linear-gradient(135deg,rgba(0,0,0,.3) 0 5px,transparent 5px 10px)';
const MODEL_TONES = ['#8b7cf6', '#c4b5fd', '#5b9dff', '#2dd4bf', '#f5a524', '#ff7ad9'];

/** Human review steps run as the `hug` agent. */
export const agent_label = (b: { agent: string; kind: Agent_kind }) => (b.kind === 'human' && b.agent === 'hug' ? 'review' : b.agent);

export function has_telemetry(t: Run_telemetry_data | null): boolean {
	return Boolean(t && (t.bars.length || t.totals.cost_usd != null || t.totals.tokens_in != null));
}

function Swatch({ color, hatch }: { color: string; hatch?: boolean }) {
	return <i aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color, backgroundImage: hatch ? HATCH : undefined }} />;
}

/* ------------------------------------------------------------------ */
/* Summary strip                                                       */

export function Summary_strip({ t }: { t: Run_telemetry_data | null }) {
	if (!t) return <div className={`${CARD} h-[86px] animate-pulse`} aria-busy="true" aria-label="Loading telemetry" />;
	const { totals } = t;
	const tm = totals.time;
	const total = totals.duration_ms ?? 0;
	const seg = [
		{ ms: tm.working_ms + tm.gates_ms + tm.other_ms, color: 'var(--g-run)', label: 'agents working' },
		{ ms: tm.people_ms, color: KIND_COLOR.human, label: 'waiting on people', hatch: true },
		{ ms: tm.queued_ms, color: QUEUE_COLOR, label: 'queued / handoffs' },
	].filter((s) => s.ms > 0);
	const seg_total = seg.reduce((a, s) => a + s.ms, 0) || 1;
	const cache = totals.cached_in != null && totals.tokens_in ? Math.round((totals.cached_in / totals.tokens_in) * 100) : null;
	const none = !has_telemetry(t);
	return (
		<section aria-label="Run summary" className={`${CARD} grid grid-cols-2 gap-4 px-4 py-3 md:grid-cols-[1.4fr_1fr_1.2fr_.9fr]`} data-testid="run-summary">
			<div className="min-w-0">
				<div className={LBL}>Time</div>
				<div className="mt-0.5 text-[20px] font-semibold">{fmt_ms(totals.duration_ms)}</div>
				{seg.length ? (
					<div className="mt-1 flex items-center gap-2 text-[11.5px] text-[var(--g-ink-3)]">
						<span className="flex h-1.5 w-[140px] shrink-0 overflow-hidden rounded-full bg-[var(--g-soft)]" role="img" aria-label={seg.map((s) => `${s.label} ${fmt_ms(s.ms)}`).join(', ')}>
							{seg.map((s) => <i key={s.label} style={{ width: `${(s.ms / seg_total) * 100}%`, background: s.color }} />)}
						</span>
						{tm.people_ms > 0 ? <span className="truncate" title={`${fmt_ms(tm.people_ms)} waiting on people`}>{Math.round(tm.people_ms / 60000)}m waiting</span> : null}
					</div>
				) : <div className="mt-1 text-[11.5px] text-[var(--g-ink-3)]">{total ? 'no agent timing reported' : ''}</div>}
			</div>
			<div className="min-w-0"><div className={LBL}>Cost</div><div className="mt-0.5 text-[20px] font-semibold">{fmt_usd(totals.cost_usd)}</div><div className="mt-1 text-[11.5px] text-[var(--g-ink-3)]">{totals.cost_usd != null ? 'estimated from model prices' : 'no model usage reported'}</div></div>
			<div className="min-w-0"><div className={LBL}>Tokens</div><div className="mt-0.5 text-[20px] font-semibold">{fmt_count(totals.tokens_in)} <span className="text-[13px] font-normal text-[var(--g-ink-3)]">in</span> · {fmt_count(totals.tokens_out)} <span className="text-[13px] font-normal text-[var(--g-ink-3)]">out</span></div><div className="mt-1 text-[11.5px] text-[var(--g-ink-3)]">{cache != null ? `${cache}% of input from cache` : none ? '' : totals.tokens_in ? <span title={`${(t.by_model ?? []).map((m) => m.provider).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'The provider'} reports no cache figures, so cache use is unknown.`}>cache not reported by provider</span> : 'no model tokens'}</div></div>
			<div className="min-w-0"><div className={LBL}>Model calls</div><div className="mt-0.5 text-[20px] font-semibold">{fmt_count(totals.model_calls)}</div><div className="mt-1 text-[11.5px] text-[var(--g-ink-3)]">{totals.agent_runs} agent run{totals.agent_runs === 1 ? '' : 's'}{totals.reworks ? ` · ${totals.reworks} rework${totals.reworks === 1 ? '' : 's'}` : ''}</div></div>
			{none ? <p className="col-span-full -mt-1 text-[11.5px] text-[var(--g-ink-3)]">{t.sections.spans === 'error' || t.sections.usage === 'error' ? 'Telemetry couldn’t be loaded.' : 'No telemetry reported for this run yet — older daemons don’t send it.'}</p> : null}
		</section>
	);
}

/** Phases tab: a time bar on the run clock + cost for one phase row. */
export function Phase_clock({ p, t }: { p: Telemetry_phase | undefined; t: Run_telemetry_data | null }) {
	const a = t?.window.start_ms; const b = t?.window.end_ms;
	if (!p || a == null || b == null || b <= a || p.start_ms == null) return <span className="block w-[200px]" />;
	const end = p.end_ms ?? b;
	const left = ((p.start_ms - a) / (b - a)) * 100;
	const width = Math.max(0.8, ((end - p.start_ms) / (b - a)) * 100);
	return (
		<span className="mt-1.5 block h-2.5 w-[200px] rounded-[3px] bg-[var(--g-soft)]" aria-hidden>
			<i className="relative block h-full rounded-[3px]" style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: KIND_COLOR[p.kind], backgroundImage: p.kind === 'human' ? HATCH : undefined }} />
		</span>
	);
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */

type Kind_filter = 'all' | 'llm' | 'gate' | 'human' | 'connector';
const FILTERS: Array<[Kind_filter, string]> = [['all', 'All'], ['llm', 'LLM'], ['gate', 'Gates'], ['human', 'People'], ['connector', 'Connectors']];
const in_filter = (f: Kind_filter, k: Agent_kind) => f === 'all' || (f === 'connector' ? k === 'connector' || k === 'shell' : f === 'llm' ? k === 'llm' || k === 'builder' || k === 'custom' : k === f);

/** A run error trimmed for one line: no long ids, no repeated "Phase 'x' failed:" prefix. */
export function short_error(e: string): string {
	return e.replace(/\s*\b[0-9a-f]{16,}\b/gi, '').replace(/^Phase '[^']+' failed:\s*/, '').replace(/\s+—\s+escalating$/, '').replace(/\s{2,}/g, ' ').trim();
}

export function Timeline({ t, selected, on_select, focus_phase, attempts, run_href, now = Date.now() }: { t: Run_telemetry_data; selected: string | null; on_select: (b: Telemetry_bar | null) => void; focus_phase?: string | null; /** The run's attempts (resumes); absent when unknown. */ attempts?: Run_attempt[] | null; /** Page path of a run (links a sub-team row to its run). */ run_href?: (run_id: string) => string; now?: number }) {
	const [filter, set_filter] = useState<Kind_filter>('all');
	const [hide_waiting, set_hide_waiting] = useState(false);
	const [crit_on, set_crit_on] = useState(false);
	const [collapsed, set_collapsed] = useState<Set<string>>(new Set());
	const w0 = t.window.start_ms ?? Math.min(...t.bars.map((b) => b.start_ms));
	const w1 = t.window.end_ms ?? now;
	const [zoom, set_zoom] = useState<[number, number] | null>(null);
	useEffect(() => {
		const p = focus_phase ? t.phases.find((x) => x.name === focus_phase) : null;
		if (p?.start_ms != null) { const e = p.end_ms ?? w1; const pad = Math.max(1000, (e - p.start_ms) * 0.05); set_zoom([p.start_ms - pad, e + pad]); }
	}, [focus_phase]); // eslint-disable-line react-hooks/exhaustive-deps
	const [a, b] = zoom ?? [w0, w1];
	const span = Math.max(1, b - a);
	const pct = (ms: number) => ((ms - a) / span) * 100;
	const crit = useMemo(() => (crit_on ? critical_path(t.phases) : new Set<string>()), [crit_on, t.phases]);
	const track = useRef<HTMLDivElement>(null);
	const [drag, set_drag] = useState<[number, number] | null>(null);
	const frac = (e: ReactMouseEvent) => { const r = track.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
	const step = tick_step(span);
	const ticks: number[] = [];
	for (let x = Math.ceil((a - w0) / step) * step; w0 + x <= b; x += step) ticks.push(x);
	const running = t.run.state === 'running' || t.run.state === 'awaiting_input';

	if (!t.bars.length) {
		return <p className={`${CARD} px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]`}>{t.sections.spans === 'error' ? 'Timeline couldn’t be loaded.' : 'No timeline yet — the daemon reports spans as agents finish. Older daemons don’t send them.'}</p>;
	}
	const bar_el = (x: Telemetry_bar, label?: string) => {
		const s = Math.max(x.start_ms, a); const e = Math.min(x.end_ms ?? now, b);
		if (e < a || s > b) return null;
		const dim = crit_on && !crit.has(x.phase);
		const sel = selected === x.id;
		return (
			<button
				type="button"
				key={x.id}
				data-testid={`bar-${x.id}`}
				aria-pressed={sel}
				aria-label={`${agent_label(x)} in ${x.phase}: ${fmt_ms((x.end_ms ?? now) - x.start_ms)}${x.status === 'error' ? ', failed' : ''}`}
				onMouseDown={(ev) => ev.stopPropagation()}
				onClick={() => on_select(sel ? null : x)}
				className={`absolute top-1 h-[18px] overflow-hidden whitespace-nowrap rounded-[4px] px-1.5 text-left text-[10.5px] font-semibold text-[var(--g-on-color)] ${x.status === 'running' ? 'animate-pulse' : ''}`}
				style={{ left: `${pct(s)}%`, width: `max(4px, ${pct(e) - pct(s)}%)`, background: KIND_COLOR[x.kind], backgroundImage: x.kind === 'human' ? HATCH : undefined, opacity: dim ? 0.25 : 1, boxShadow: sel ? '0 0 0 2px #fff' : x.status === 'error' ? '0 0 0 1.5px var(--g-bad)' : undefined }}
			>
				{label ?? (x.status === 'error' ? '✕' : '')}
			</button>
		);
	};
	/** "waiting for review · 30m" on a review bar wide enough to hold it. */
	const wait_label = (x: Telemetry_bar) => (x.kind === 'human' && pct(Math.min(x.end_ms ?? now, b)) - pct(Math.max(x.start_ms, a)) > 18 ? `waiting for review · ${fmt_ms((x.end_ms ?? now) - x.start_ms)}` : undefined);
	const toggle = (key: string) => set_collapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
	/**
	 * One phase lane: its header (with its own span), its agent bars, and — for a phase that
	 * started a sub-team — that run nested inside it, indented one level per sub-team.
	 */
	const lane = (p: Telemetry_phase, bars: Telemetry_bar[], depth: number, key: string): ReactNode => {
		const rows = bars.filter((x) => x.phase === p.name && in_filter(filter, x.kind) && !(hide_waiting && x.kind === 'human'));
		const subs = p.sub_runs ?? [];
		if (!rows.length && !subs.length && (filter !== 'all' || hide_waiting)) return null;
		const open = !collapsed.has(key);
		const multi = new Set(rows.map((x) => x.agent)).size < rows.length;
		const top = depth === 0;
		const indent = { paddingLeft: `${depth * 14}px` };
		const reran = p.runs > 1 ? <span className="ml-1 text-[11px] font-normal text-[var(--g-warn-text)]">↻{p.runs}</span> : null;
		const name_cls = `${top && crit_on && crit.has(p.name) ? 'text-[var(--g-acc)]' : ''} ${p.status === 'failed' ? 'text-[var(--g-bad)]' : ''}`;
		// One agent and nothing nested: a single row (phase name, agent, its bar) instead of two.
		if (rows.length === 1 && !subs.length) {
			const x = rows[0];
			return (
				<div key={key} data-testid={`lane-${key}`} className="grid h-7 grid-cols-[170px_minmax(0,1fr)] items-center">
					<span className="truncate text-[12.5px]" style={{ paddingLeft: `${depth * 14 + 11}px` }} title={`${p.name} · ${agent_label(x)}`}>
						<span className={`g-mono font-semibold ${name_cls}`}>{p.name}</span>{reran}
						<span className="ml-1.5 text-[11px] text-[var(--g-ink-3)]">{agent_label(x)}</span>
					</span>
					<div className="relative h-full">{bar_el(x, wait_label(x))}</div>
				</div>
			);
		}
		return (
			<div key={key} data-testid={`lane-${key}`}>
				<div className="grid h-7 grid-cols-[170px_minmax(0,1fr)] items-center">
					<button type="button" aria-expanded={open} onClick={() => toggle(key)} style={indent} className={`truncate text-left text-[12.5px] font-semibold ${name_cls}`}>{open ? '▾' : '▸'} <span className="g-mono">{p.name}</span>{reran}</button>
					<div className="relative h-full">
						{p.start_ms != null ? <i aria-hidden className="absolute top-2 h-3 rounded-[3px]" style={{ left: `${pct(Math.max(p.start_ms, a))}%`, width: `max(3px, ${pct(Math.min(p.end_ms ?? now, b)) - pct(Math.max(p.start_ms, a))}%)`, background: `${KIND_COLOR[p.kind]}40`, backgroundImage: p.kind === 'human' ? HATCH : undefined, opacity: top && crit_on && !crit.has(p.name) ? 0.25 : 1 }} /> : null}
					</div>
				</div>
				{open ? rows.map((x, i) => {
					const prev = x.run_index > 1 ? rows.slice(0, i).reverse().find((r) => r.agent === x.agent) : undefined;
					return (
						<div key={x.id} className="grid h-7 grid-cols-[170px_minmax(0,1fr)] items-center">
							<span className="truncate text-[12px] text-[var(--g-ink-2)]" style={{ paddingLeft: `${depth * 14 + 16}px` }}>{agent_label(x)}{multi && rows.filter((r) => r.agent === x.agent).length > 1 ? ` · ${x.kind === 'gate' ? 'iter' : 'run'} ${x.run_index}` : ''}{x.model ? <span className="g-mono ml-1.5 text-[10.5px] text-[var(--g-ink-3)]">{x.model.replace(/^claude-/, '')}</span> : null}</span>
							<div className="relative h-full">
								{prev?.end_ms != null ? <i aria-hidden className="absolute top-[13px] border-t-[1.5px] border-dashed" style={{ borderColor: KIND_COLOR.gate, left: `${pct(Math.max(prev.end_ms, a))}%`, width: `${Math.max(0, pct(Math.min(x.start_ms, b)) - pct(Math.max(prev.end_ms, a)))}%` }} title="sent back for rework" /> : null}
								{bar_el(x, wait_label(x))}
							</div>
						</div>
					);
				}) : null}
				{open ? subs.map((r) => sub_run(r, depth + 1, `${key}/${r.run_id}`)) : null}
			</div>
		);
	};
	/** A sub-team run inside its parent phase: team, state, why it failed, then its own lanes. */
	const sub_run = (r: Telemetry_sub_run, depth: number, key: string): ReactNode => {
		const open = !collapsed.has(key);
		const failed = r.state === 'failed' || r.state === 'crashed';
		const team = r.team ?? r.run_name ?? 'run';
		const start = pct(Math.max(r.start_ms ?? a, a));
		const err = failed && r.error ? `${r.state === 'crashed' ? 'Crashed' : 'Failed'}: ${short_error(r.error)}` : null;
		return (
			<div key={key} data-testid={`sub-run-${r.run_id}`}>
				<div className="grid h-7 grid-cols-[170px_minmax(0,1fr)] items-center">
					<button type="button" aria-expanded={open} onClick={() => toggle(key)} style={{ paddingLeft: `${depth * 14}px` }} title={`Sub-team ${team}${r.run_name ? ` · ${r.run_name}` : ''}`} className="truncate text-left text-[12px] text-[var(--g-ink-2)]">
						{open ? '▾' : '▸'} <span aria-hidden className="text-[var(--g-ink-3)]">⤷</span> <span className="g-mono font-semibold text-[var(--g-ink)]">{team.replace(/^@[^/]+\//, '')}</span>
					</button>
					<div className="relative h-full min-w-0">
						<span className="absolute top-1.5 max-w-full truncate text-[11px] text-[var(--g-ink-3)]" style={{ left: `${Math.min(start, 85)}%` }}>
							sub-team{r.run_name ? <> · {run_href ? <Link to={run_href(r.run_id)} data-testid={`sub-run-link-${r.run_id}`} onMouseDown={(e) => e.stopPropagation()} className="g-mono text-[var(--g-acc)] hover:underline">{r.run_name} ↗</Link> : <span className="g-mono">{r.run_name}</span>}</> : null} · <span className={failed ? 'text-[var(--g-bad)]' : ''}>{r.state}</span>{r.usage?.cost_usd != null ? <> · <span data-testid={`sub-run-cost-${r.run_id}`}>{fmt_usd(r.usage.cost_usd)}</span></> : null}
						</span>
					</div>
				</div>
				{err ? (
					<div className="grid grid-cols-[170px_minmax(0,1fr)] pb-1">
						<span />
						<p role="note" data-testid={`sub-run-error-${r.run_id}`} title={r.error ?? undefined} className="truncate text-[11.5px] text-[var(--g-bad)]">{err}</p>
					</div>
				) : null}
				{open ? r.phases.map((cp) => lane(cp, r.bars, depth, `${key}/${cp.name}`)) : null}
			</div>
		);
	};
	/** Resumes (from the run's attempts) and phases that ran more than once, sub-teams included. */
	const resumes = (attempts ?? []).filter((x) => x.n > 1);
	const reran: string[] = [];
	const walk = (ps: Telemetry_phase[]) => { for (const p of ps) { if (p.runs > 1) reran.push(`${p.name} ×${p.runs}`); for (const r of p.sub_runs ?? []) walk(r.phases); } };
	walk(t.phases);
	const who = (x: Run_attempt) => x.resumed_by?.display_name || x.resumed_by?.username || null;
	return (
		<div className="flex flex-col gap-2" data-testid="timeline">
			<div className="flex flex-wrap items-center gap-2">
				{FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => set_filter(k)} className={CHIP(filter === k)}>{l}</button>)}
				<button type="button" aria-pressed={hide_waiting} onClick={() => set_hide_waiting((v) => !v)} className={`${CHIP(hide_waiting)} ml-2`}>Hide waiting</button>
				<button type="button" aria-pressed={crit_on} onClick={() => set_crit_on((v) => !v)} className={CHIP(crit_on)} title="The chain of phases that made the run as long as it was">Critical path</button>
				<span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">{zoom ? <button type="button" onClick={() => set_zoom(null)} className="text-[var(--g-acc)] hover:underline">Reset zoom</button> : 'Drag across the chart to zoom'}</span>
			</div>
			{attempts != null || reran.length ? (
				<p data-testid="timeline-history" className="text-[11.5px] text-[var(--g-ink-3)]">
					{attempts == null ? null : resumes.length === 0 ? 'Not resumed' : (
						<>
							<span className="font-semibold text-[var(--g-warn-text)]">Resumed {resumes.length}×</span>
							{resumes.map((x) => <span key={x.n}> · {x.from_phase ? <>from <span className="g-mono">{x.from_phase}</span></> : 'resumed'}{who(x) ? ` by ${who(x)}` : ''}{x.started_at ? `, ${relative_time(x.started_at)}` : ''}</span>)}
						</>
					)}
					{attempts != null ? ' · ' : null}
					{reran.length ? <>Re-ran: <span className="g-mono text-[var(--g-warn-text)]">{reran.join(', ')}</span></> : 'No phase re-ran'}
				</p>
			) : null}
			<div className={`${CARD} select-none px-3 pb-3 pt-7`}>
				<div className="relative grid grid-cols-[170px_minmax(0,1fr)]">
					<div />
					<div ref={track} className="relative h-0">
						{ticks.map((x) => <span key={x} className="g-mono absolute -top-5 -translate-x-1/2 text-[10.5px] text-[var(--g-ink-3)]" style={{ left: `${pct(w0 + x)}%` }}>{tick_label(x)}</span>)}
					</div>
				</div>
				<div
					className="relative"
					onMouseDown={(e) => { if (track.current && e.clientX > track.current.getBoundingClientRect().left) { const f = frac(e); set_drag([f, f]); } }}
					onMouseMove={(e) => { if (drag) set_drag([drag[0], frac(e)]); }}
					onMouseUp={() => { if (drag && Math.abs(drag[1] - drag[0]) > 0.02) { const [x0, x1] = [Math.min(...drag), Math.max(...drag)]; set_zoom([a + x0 * span, a + x1 * span]); } set_drag(null); }}
					onMouseLeave={() => set_drag(null)}
				>
					{/* grid lines */}
					<div aria-hidden className="pointer-events-none absolute inset-y-0 left-[170px] right-0">
						{ticks.map((x) => <i key={x} className="absolute inset-y-0 border-l border-dashed border-[var(--g-line-2,#1e2024)]" style={{ left: `${pct(w0 + x)}%` }} />)}
						{running && now <= b ? <i className="absolute inset-y-0 border-l border-[var(--g-acc)]" style={{ left: `${pct(now)}%` }} title="now" /> : null}
						{resumes.filter((x) => x.started_at != null && x.started_at >= a && x.started_at <= b).map((x) => (
							<i key={x.n} data-testid={`resume-mark-${x.n}`} className="absolute inset-y-0 border-l-2 border-[var(--g-warn-text)]" style={{ left: `${pct(x.started_at!)}%` }} title={`Resumed${x.from_phase ? ` from ${x.from_phase}` : ''}${who(x) ? ` by ${who(x)}` : ''}`}>
								<span className="absolute -top-0.5 left-1 whitespace-nowrap text-[10.5px] font-semibold not-italic text-[var(--g-warn-text)]">↻ resumed</span>
							</i>
						))}
						{drag ? <i className="absolute inset-y-0 bg-[var(--g-acc-soft)]" style={{ left: `${Math.min(...drag) * 100}%`, width: `${Math.abs(drag[1] - drag[0]) * 100}%` }} /> : null}
					</div>
					{t.phases.map((p) => lane(p, t.bars, 0, p.name))}
				</div>
				<div className="mt-3 flex flex-wrap gap-3 border-t border-[var(--g-line)] pt-2 text-[11px] text-[var(--g-ink-3)]">
					{(['llm', 'gate', 'human', 'connector', 'shell'] as Agent_kind[]).filter((k) => t.bars.some((x) => x.kind === k)).map((k) => <span key={k} className="flex items-center gap-1.5"><Swatch color={KIND_COLOR[k]} hatch={k === 'human'} />{k === 'human' ? 'waiting on people' : KIND_LABEL[k]}</span>)}
					{t.totals.reworks ? <span className="flex items-center gap-1.5"><i className="inline-block w-4 border-t-[1.5px] border-dashed" style={{ borderColor: KIND_COLOR.gate }} />sent back for rework</span> : null}
				</div>
			</div>
		</div>
	);
}

/** Replaces the run page's side column while a bar is selected. */
export function Span_details({ bar, t, realm_id, on_close, on_logs }: { bar: Telemetry_bar; t: Run_telemetry_data; realm_id: string | null; on_close: () => void; on_logs: (q: string) => void }) {
	const auth_fetch = useAuthFetch();
	const [lines, set_lines] = useState<string[] | null>(null);
	const q = `[${bar.agent}]`;
	useEffect(() => {
		if (!realm_id) { set_lines([]); return; }
		let off = false;
		set_lines(null);
		void (async () => {
			try {
				const res = await auth_fetch('/v1/runs/get_logs', { method: 'POST', body: JSON.stringify({ realm_id, run_ids: [t.run.run_id], q, limit: 4, offset: 0, since_ms: bar.start_ms, ...(bar.end_ms ? { until_ms: bar.end_ms + 1000 } : {}) }) });
				const d = await res.json().catch(() => null);
				const ls = (d?.lines ?? d?.data?.lines ?? []) as Array<{ message: string }>;
				if (!off) set_lines(ls.map((l) => l.message).reverse());
			} catch { if (!off) set_lines([]); }
		})();
		return () => { off = true; };
	}, [bar.id, realm_id]); // eslint-disable-line react-hooks/exhaustive-deps
	const dur = (bar.end_ms ?? Date.now()) - bar.start_ms;
	const share = bar.cost_usd != null && t.totals.cost_usd ? Math.round((bar.cost_usd / t.totals.cost_usd) * 100) : null;
	const cache = bar.cached_in != null && bar.units_in ? Math.round((bar.cached_in / bar.units_in) * 100) : null;
	const rows: Array<[string, string | null]> = [
		['Model', bar.model ? `${bar.model}${bar.provider ? ` · ${bar.provider}` : ''}` : null],
		['Time', `${fmt_ms(dur)}${bar.end_ms ? '' : ' so far'}`],
		[bar.unit_kind === 'tokens' ? 'Tokens' : 'Units', bar.units_in != null || bar.units_out != null ? `${fmt_units(bar.unit_kind, bar.units_in, bar.units_out)}${cache != null ? ` · ${cache}% cached` : ''}` : null],
		['Calls', bar.calls != null ? `${bar.calls} ${bar.kind === 'llm' ? 'model' : 'external'} calls` : null],
		['Cost', bar.cost_usd != null ? `${fmt_usd(bar.cost_usd)}${share != null ? ` (${share}% of run)` : ''}${bar.cost_estimated ? ' · est.' : ''}` : null],
		['Outcome', [bar.outcome ?? (bar.status === 'running' ? 'running' : bar.status), bar.exit_code != null ? `exit ${bar.exit_code}` : null, bar.attempts != null ? `${bar.attempts} attempt${bar.attempts === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')],
	];
	return (
		<aside aria-label="Selected agent" className={`${CARD} flex flex-col self-start gap-3 p-4 text-[12.5px]`} data-testid="span-details">
			<div className="flex items-center gap-2"><Swatch color={KIND_COLOR[bar.kind]} hatch={bar.kind === 'human'} /><b className="text-[14px]">{agent_label(bar)}</b><span className="truncate text-[var(--g-ink-3)]">{bar.phase} · {KIND_LABEL[bar.kind]}</span><button type="button" aria-label="Close details" onClick={on_close} className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button></div>
			<dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2">
				{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-[var(--g-ink-3)]">{k}</dt><dd className={`min-w-0 break-words ${k === 'Outcome' && bar.status === 'error' ? 'text-[var(--g-bad)]' : ''}`}>{v}</dd></div>)}
			</dl>
			<div className="border-t border-[var(--g-line)] pt-3">
				<b className="text-[12px]">Last log lines</b>
				<div className="g-mono mt-1.5 flex flex-col gap-1 text-[11px] text-[var(--g-ink-2)]">
					{lines === null ? <span className="text-[var(--g-ink-3)]">Loading…</span> : !lines.length ? <span className="text-[var(--g-ink-3)]">No log lines for this agent.</span> : lines.map((l, i) => <span key={i} className="truncate" title={l}>{l}</span>)}
				</div>
			</div>
			<button type="button" onClick={() => on_logs(q)} className="w-fit rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[12px] font-semibold hover:bg-[var(--g-soft)]">Logs for this agent →</button>
		</aside>
	);
}

/* ------------------------------------------------------------------ */
/* Usage                                                               */

export function Usage({ t }: { t: Run_telemetry_data }) {
	// Both tables are whole-run totals (every model / agent), so sorting here is exact.
	const model_sort = use_table_sort({ keys: ['model', 'calls', 'tokens_in', 'tokens_out', 'cost'], mode: 'client', param: 'models', first_dir: { calls: 'desc', tokens_in: 'desc', tokens_out: 'desc', cost: 'desc' } });
	const agent_sort = use_table_sort({ keys: ['agent', 'phase', 'runs', 'time', 'cost'], mode: 'client', param: 'agents', first_dir: { runs: 'desc', time: 'desc', cost: 'desc' } });
	const by_model = sort_rows(t.by_model, model_sort, { model: (m) => m.model, calls: (m) => m.calls, tokens_in: (m) => m.tokens_in, tokens_out: (m) => m.tokens_out, cost: (m) => m.cost_usd });
	const by_agent = sort_rows(t.by_agent, agent_sort, { agent: (g) => agent_label(g), phase: (g) => g.phase, runs: (g) => g.runs, time: (g) => g.duration_ms, cost: (g) => g.cost_usd });
	const costs = phase_model_costs(t);
	const models = [...new Set([...t.by_model.map((m) => m.model), ...costs.flatMap((c) => c.parts.map((p) => p.model))])];
	const tone = (m: string) => (m === 'other' ? '#6b6e76' : MODEL_TONES[models.indexOf(m) % MODEL_TONES.length]);
	const max = Math.max(0.0001, ...costs.map((c) => c.total));
	const tm = t.totals.time;
	const total = t.totals.duration_ms ?? 0;
	const time_rows: Array<[string, number, string, boolean?]> = [
		['Waiting on people', tm.people_ms, KIND_COLOR.human, true],
		['LLM agents working', tm.working_ms, KIND_COLOR.llm],
		['Gate checks', tm.gates_ms, KIND_COLOR.gate],
		['Shell + connectors', tm.other_ms, KIND_COLOR.shell],
		['Queued / handoffs', tm.queued_ms, QUEUE_COLOR],
	];
	const no_cost = t.phases.filter((p) => !costs.some((c) => c.phase === p.name)).map((p) => p.name);
	const cost_total = t.totals.cost_usd ?? costs.reduce((a, c) => a + c.total, 0);
	const csv = () => {
		const blob = new Blob([by_agent_csv(t)], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const el = document.createElement('a'); el.href = url; el.download = `${t.run.run_id}-usage.csv`; el.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
	if (!has_telemetry(t)) return <p className={`${CARD} px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]`}>No usage reported for this run yet.</p>;
	return (
		<div className="flex flex-col gap-3" data-testid="usage">
			<div className="grid gap-3 lg:grid-cols-2">
				<section aria-label="Cost by phase" className={CARD}>
					<h3 className="border-b border-[var(--g-line)] px-4 py-2.5 text-[14px] font-semibold">Where the money went <span className="text-[12px] font-normal text-[var(--g-ink-3)]">by phase, split by model</span></h3>
					<div className="flex flex-col gap-2.5 px-4 py-3">
						{!costs.length ? <p className="text-[12.5px] text-[var(--g-ink-3)]">No model cost reported.</p> : costs.map((c) => (
							<div key={c.phase} className="grid grid-cols-[88px_minmax(0,1fr)_56px] items-center gap-2" data-testid={`cost-${c.phase}`}>
								<b className="g-mono truncate text-[12.5px]">{c.phase}</b>
								<span className="flex h-3.5 overflow-hidden rounded-[4px]" style={{ width: `${(c.total / max) * 100}%` }}>{c.parts.map((p) => <i key={p.model} title={`${p.model}: ${fmt_usd(p.cost)}`} style={{ width: `${(p.cost / c.total) * 100}%`, background: tone(p.model) }} />)}</span>
								<span className="g-mono text-right text-[12.5px]">{fmt_usd(c.total)}</span>
							</div>
						))}
						<div className="flex flex-wrap gap-3 text-[11px] text-[var(--g-ink-3)]">{models.filter((m) => m !== 'other').map((m) => <span key={m} className="flex items-center gap-1.5"><Swatch color={tone(m)} />{m}</span>)}{no_cost.length ? <span className="ml-auto">{no_cost.join(', ')}: no model cost</span> : null}</div>
					</div>
				</section>
				<section aria-label="Time breakdown" className={CARD}>
					<h3 className="border-b border-[var(--g-line)] px-4 py-2.5 text-[14px] font-semibold">Where the time went <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{fmt_ms(total)}</span></h3>
					<div className="flex flex-col gap-2 px-4 py-3 text-[12.5px]">
						{time_rows.filter(([, ms]) => ms > 0).map(([l, ms, c, hatch]) => (
							<div key={l} className="grid grid-cols-[minmax(0,1fr)_90px_60px] items-center gap-2"><span className="truncate">{l}</span><span className="h-2 rounded-full bg-[var(--g-soft)]"><i className="block h-2 rounded-full" style={{ width: `${Math.min(100, total ? (ms / total) * 100 : 0)}%`, background: c, backgroundImage: hatch ? HATCH : undefined }} /></span><span className="g-mono text-right">{fmt_ms(ms)}</span></div>
						))}
						{total && tm.people_ms / total >= 0.4 ? <p className="border-t border-[var(--g-line)] pt-2 text-[12px] text-[var(--g-ink-3)]">{Math.round((tm.people_ms / total) * 100)}% of this run was waiting on a person.</p> : null}
					</div>
				</section>
			</div>
			<section aria-label="By model" className={`${CARD} overflow-x-auto`}>
				<h3 className="border-b border-[var(--g-line)] px-4 py-2.5 text-[14px] font-semibold">By model</h3>
				<table className="w-full text-[12.5px]"><thead><tr><Sort_th sort={model_sort} k="model" className={TH}>Model</Sort_th><Sort_th sort={model_sort} k="calls" className={TH}>Calls</Sort_th><Sort_th sort={model_sort} k="tokens_in" className={TH}>Tokens in</Sort_th><th className={TH}>Cached</th><Sort_th sort={model_sort} k="tokens_out" className={TH}>Tokens out</Sort_th><Sort_th sort={model_sort} k="cost" className={TH}>Cost</Sort_th><th className={`${TH} w-[140px]`}>Share</th></tr></thead>
					<tbody>
						{!t.by_model.length ? <tr><td colSpan={7} className="px-4 py-4 text-[var(--g-ink-3)]">No model usage reported.</td></tr> : by_model.map((m) => (
							<tr key={m.model} className="border-t border-[var(--g-line-2,#1e2024)]" data-testid={`model-${m.model}`}>
								<td className="px-4 py-2.5"><span className="flex items-center gap-2"><Swatch color={tone(m.model)} /><span className="g-mono">{m.model}</span>{m.provider ? <span className="text-[var(--g-ink-3)]">{m.provider}</span> : null}</span></td>
								<td className="g-mono">{fmt_count(m.calls)}</td><td className="g-mono">{fmt_count(m.tokens_in)}</td>
								<td className="g-mono">{m.cached_in != null && m.tokens_in ? `${Math.round((m.cached_in / m.tokens_in) * 100)}%` : '—'}</td>
								<td className="g-mono">{fmt_count(m.tokens_out)}</td><td className="g-mono">{fmt_usd(m.cost_usd)}</td>
								<td className="pr-4">{m.cost_usd != null && cost_total ? <span className="flex items-center gap-2"><span className="h-2 flex-1 rounded-full bg-[var(--g-soft)]"><i className="block h-2 rounded-full" style={{ width: `${(m.cost_usd / cost_total) * 100}%`, background: tone(m.model) }} /></span><span className="g-mono text-[11px] text-[var(--g-ink-3)]">{Math.round((m.cost_usd / cost_total) * 100)}%</span></span> : null}</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>
			<section aria-label="By agent" className={`${CARD} overflow-x-auto`}>
				<h3 className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-2.5 text-[14px] font-semibold">By agent {agent_sort.by ? null : <span className="text-[12px] font-normal text-[var(--g-ink-3)]">sorted by cost</span>}<button type="button" onClick={csv} className="ml-auto rounded-md border border-[var(--g-line)] px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--g-soft)]">Export CSV</button></h3>
				<table className="w-full text-[12.5px]"><thead><tr><Sort_th sort={agent_sort} k="agent" className={TH}>Agent</Sort_th><Sort_th sort={agent_sort} k="phase" className={TH}>Phase</Sort_th><Sort_th sort={agent_sort} k="runs" className={TH}>Runs</Sort_th><Sort_th sort={agent_sort} k="time" className={TH}>Time</Sort_th><th className={TH}>Units</th><Sort_th sort={agent_sort} k="cost" className={TH}>Cost</Sort_th><th className={TH}>Outcome</th></tr></thead>
					<tbody>
						{by_agent.map((g) => (
							<tr key={`${g.phase}/${g.agent}`} className="border-t border-[var(--g-line-2,#1e2024)]" data-testid={`agent-${g.agent}`}>
								<td className="px-4 py-2"><span className="flex items-center gap-2"><Swatch color={KIND_COLOR[g.kind]} hatch={g.kind === 'human'} /><b>{agent_label(g)}</b></span></td>
								<td className="g-mono text-[var(--g-ink-2)]">{g.phase}</td><td className="g-mono">{g.runs}</td><td className="g-mono">{fmt_ms(g.duration_ms)}</td>
								<td className="g-mono text-[var(--g-ink-2)]">{fmt_units(g.unit_kind, g.units_in, g.units_out)}</td><td className="g-mono">{fmt_usd(g.cost_usd)}</td>
								<td>{g.failures ? <span className="text-[var(--g-warn-text)]">{g.failures} failed{g.runs > g.failures ? ' → ' + (g.outcome ?? 'ok') : ''}</span> : <span className="text-[var(--g-ok)]">{g.outcome ?? 'ok'}</span>}</td>
							</tr>
						))}
					</tbody>
				</table>
				<p className="border-t border-[var(--g-line)] px-4 py-2 text-[11.5px] text-[var(--g-ink-3)]">Costs are estimates from token counts and model prices; an agent’s share is split from its phase by tokens when the agent doesn’t report its own.</p>
			</section>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* DAG                                                                 */

type Heat = 'status' | 'duration' | 'cost' | 'tokens';
const STATUS_TONE: Record<string, string> = { completed: 'rgba(62,207,142,.14)', running: 'rgba(91,157,255,.16)', failed: 'rgba(255,92,92,.18)', crashed: 'rgba(255,92,92,.18)', awaiting_input: 'rgba(255,178,36,.16)' };

export function Dag({ t, on_open }: { t: Run_telemetry_data; on_open: (phase: string) => void }) {
	const [heat, set_heat] = useState<Heat>('duration');
	const layers = useMemo(() => dag_layers(t.phases), [t.phases]);
	const val = (p: Telemetry_phase) => (heat === 'duration' ? p.duration_ms : heat === 'cost' ? p.cost_usd : heat === 'tokens' ? (p.tokens_in ?? 0) + (p.tokens_out ?? 0) || null : null);
	const max = Math.max(0, ...t.phases.map((p) => val(p) ?? 0));
	const W = 210; const H = 62; const GX = 28; const GY = 44;
	const width = Math.max(...layers.map((l) => l.length)) * (W + GX) - GX;
	const pos = new Map<string, { x: number; y: number }>();
	layers.forEach((l, d) => { const row_w = l.length * (W + GX) - GX; l.forEach((p, i) => pos.set(p.name, { x: (width - row_w) / 2 + i * (W + GX), y: d * (H + GY) })); });
	const height = layers.length * (H + GY) - GY;
	const fmt = (p: Telemetry_phase) => (heat === 'cost' ? fmt_usd(p.cost_usd) : heat === 'tokens' ? fmt_count((p.tokens_in ?? 0) + (p.tokens_out ?? 0) || null) : fmt_ms(p.duration_ms));
	if (!t.phases.length) return <p className={`${CARD} px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]`}>No phases yet.</p>;
	return (
		<div className="flex flex-col gap-2" data-testid="dag">
			<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--g-ink-3)]">Colour by {(['status', 'duration', 'cost', 'tokens'] as Heat[]).map((h) => <button key={h} type="button" aria-pressed={heat === h} onClick={() => set_heat(h)} className={`${CHIP(heat === h)} capitalize`}>{h}</button>)}
				{heat !== 'status' ? <span className="ml-auto flex items-center gap-2">0<span className="h-2 w-[120px] rounded-full" style={{ background: 'linear-gradient(90deg,rgba(255,92,92,0),rgba(255,92,92,.4))' }} />{heat === 'cost' ? fmt_usd(max) : heat === 'tokens' ? fmt_count(max) : fmt_ms(max)}</span> : null}
			</div>
			<div className={`${CARD} overflow-auto p-6`} style={{ backgroundImage: 'radial-gradient(var(--g-line) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
				<div className="relative mx-auto" style={{ width, height: height + 8 }}>
					<svg aria-hidden className="absolute inset-0 overflow-visible" width={width} height={height}>
						{t.phases.flatMap((p) => p.depends_on.filter((d) => pos.has(d)).map((d) => {
							const a = pos.get(d)!; const b = pos.get(p.name)!;
							const x1 = a.x + W / 2; const y1 = a.y + H; const x2 = b.x + W / 2; const y2 = b.y;
							return <path key={`${d}>${p.name}`} d={`M${x1},${y1} C${x1},${y1 + GY / 2} ${x2},${y2 - GY / 2} ${x2},${y2}`} fill="none" stroke="#6b6e76" strokeWidth="1.5" />;
						}))}
						{t.phases.filter((p) => p.runs > 1 && pos.has(p.name)).map((p) => { const b = pos.get(p.name)!; return <path key={`loop-${p.name}`} d={`M${b.x + W},${b.y + 18} C${b.x + W + 40},${b.y + 8} ${b.x + W + 40},${b.y + H - 8} ${b.x + W},${b.y + H - 18}`} fill="none" stroke={KIND_COLOR.gate} strokeDasharray="4 3" strokeWidth="1.5" />; })}
					</svg>
					{t.phases.map((p) => {
						const at = pos.get(p.name)!;
						const v = val(p);
						const bg = heat === 'status' ? STATUS_TONE[p.status] ?? 'transparent' : `rgba(255,92,92,${max && v ? (v / max) * 0.32 : 0})`;
						return (
							<button key={p.name} type="button" onClick={() => on_open(p.name)} data-testid={`node-${p.name}`} title="Open in the timeline" className="absolute rounded-[10px] border-[1.5px] px-3 py-2 text-left hover:brightness-125" style={{ left: at.x, top: at.y, width: W, height: H, borderColor: KIND_COLOR[p.kind], background: bg }}>
								<span className="flex items-center gap-2"><b className="g-mono truncate text-[12.5px]">{p.name}</b><span className="ml-auto text-[10px] font-bold uppercase" style={{ color: KIND_COLOR[p.kind] }}>{KIND_LABEL[p.kind]}</span></span>
								<span className="g-mono mt-1 flex text-[11.5px] text-[var(--g-ink-2)]"><span>{fmt_ms(p.duration_ms)}{p.runs > 1 ? ` · ↻${p.runs}` : ''}</span><span className="ml-auto">{heat === 'status' ? p.status : heat === 'duration' ? fmt_usd(p.cost_usd) : fmt(p)}</span></span>
							</button>
						);
					})}
					{t.phases.filter((p) => p.runs > 1 && pos.has(p.name)).map((p) => { const b = pos.get(p.name)!; return <span key={`lbl-${p.name}`} className="absolute whitespace-nowrap text-[11px]" style={{ left: b.x + W + 44, top: b.y + H / 2 - 8, color: KIND_COLOR.gate }}>rework ×{p.runs - 1}</span>; })}
				</div>
			</div>
			{t.sections.workflow !== 'ok' ? <p className="text-[11.5px] text-[var(--g-ink-3)]">The team’s workflow couldn’t be read, so phases are shown in run order.</p> : null}
		</div>
	);
}
