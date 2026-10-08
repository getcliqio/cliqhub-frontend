/** Run telemetry (BFF `POST /v1/run_telemetry/get`) — types and small helpers. */

export type Agent_kind = 'llm' | 'gate' | 'human' | 'connector' | 'shell' | 'builder' | 'custom';

export interface Telemetry_bar {
	id: string;
	phase: string;
	agent: string;
	kind: Agent_kind;
	model: string | null;
	provider: string | null;
	start_ms: number;
	end_ms: number | null;
	status: 'ok' | 'error' | 'running';
	outcome: string | null;
	exit_code: number | null;
	attempts: number | null;
	unit_kind: string | null;
	units_in: number | null;
	units_out: number | null;
	cached_in: number | null;
	calls: number | null;
	cost_usd: number | null;
	cost_estimated: boolean;
	run_index: number;
}

export interface Telemetry_phase {
	name: string;
	kind: Agent_kind;
	type: string | null;
	status: string;
	start_ms: number | null;
	end_ms: number | null;
	duration_ms: number | null;
	cost_usd: number | null;
	tokens_in: number | null;
	tokens_out: number | null;
	runs: number;
	gate_outcome: string | null;
	depends_on: string[];
	/** Sub-team runs this phase started, each with its own steps (nested in the timeline). */
	/** The phase's error as recorded; absent from an older BFF. */
	error?: string | null;
	sub_runs?: Telemetry_sub_run[];
}

/** A sub-team run nested under the phase that started it. */
export interface Telemetry_sub_run {
	run_id: string;
	run_name: string | null;
	/** `@scope/name` of the sub-team. */
	team: string | null;
	state: string;
	/** Why it failed, as the run recorded it. */
	error: string | null;
	start_ms: number | null;
	end_ms: number | null;
	phases: Telemetry_phase[];
	bars: Telemetry_bar[];
	/** Its model usage, its own sub-teams included (already in the run's totals); absent from an older BFF. */
	usage?: { cost_usd: number | null; tokens_in: number | null; tokens_out: number | null; cached_in: number | null; model_calls: number | null };
}

export interface Run_telemetry_data {
	run: { run_id: string; state: string; started_at: number | null; completed_at: number | null };
	window: { start_ms: number | null; end_ms: number | null };
	totals: {
		duration_ms: number | null;
		cost_usd: number | null;
		tokens_in: number | null;
		tokens_out: number | null;
		cached_in: number | null;
		model_calls: number | null;
		agent_runs: number;
		reworks: number;
		time: { working_ms: number; people_ms: number; gates_ms: number; other_ms: number; queued_ms: number };
	};
	phases: Telemetry_phase[];
	bars: Telemetry_bar[];
	by_model: Array<{ model: string; provider: string | null; calls: number | null; tokens_in: number; tokens_out: number; cached_in: number | null; cost_usd: number | null }>;
	by_agent: Array<{ agent: string; phase: string; kind: Agent_kind; runs: number; duration_ms: number; unit_kind: string | null; units_in: number | null; units_out: number | null; cost_usd: number | null; failures: number; outcome: string | null }>;
	sections: Record<'usage' | 'spans' | 'phases' | 'workflow', 'ok' | 'error' | 'empty'>;
	partial: boolean;
}

/** Colour per agent kind (people = pink, gates = amber …). */
export const KIND_COLOR: Record<Agent_kind, string> = {
	llm: '#8b7cf6',
	gate: '#f5a524',
	human: '#ff7ad9',
	connector: '#2dd4bf',
	shell: '#5b9dff',
	builder: '#c084fc',
	custom: '#8a8c93',
};
export const KIND_LABEL: Record<Agent_kind, string> = { llm: 'LLM', gate: 'gate', human: 'people', connector: 'connector', shell: 'shell', builder: 'builder', custom: 'custom' };
export const QUEUE_COLOR = '#4a4d55';

export function fmt_usd(v: number | null | undefined, digits = 2): string {
	if (v == null || !Number.isFinite(v)) return '—';
	if (v > 0 && v < 0.01) return '<$0.01';
	return `$${v.toFixed(digits)}`;
}

/** 1204 → 1.2k, 1_490_000 → 1.49M. */
export function fmt_count(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '—';
	const a = Math.abs(v);
	if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
	if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}k`;
	return String(Math.round(v));
}

export function fmt_ms(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function fmt_units(unit: string | null, n_in: number | null, n_out: number | null): string {
	if (n_in == null && n_out == null) return '—';
	if (unit === 'tokens') return `${fmt_count(n_in)} / ${fmt_count(n_out)} tokens`;
	if (unit === 'bytes') return `${fmt_count((n_in ?? 0) + (n_out ?? 0))}B`;
	if (unit === 'calls') return `${fmt_count((n_in ?? 0) + (n_out ?? 0))} calls`;
	if (unit === 'records') return `${fmt_count(n_in)} checks`;
	if (unit === 'files') return `${fmt_count(n_out ?? n_in)} files`;
	return `${fmt_count(n_in)} / ${fmt_count(n_out)}`;
}

/** A tick step (ms) giving ~5–8 ticks across `span_ms`. */
export function tick_step(span_ms: number): number {
	const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].map((s) => s * 1000);
	return steps.find((s) => span_ms / s <= 8) ?? 28800_000;
}

export function tick_label(offset_ms: number): string {
	const s = Math.round(offset_ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.round(s / 60);
	return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

/**
 * Phases that decided the run's length: from the phase that finished last,
 * walk back through the dependency that finished last.
 */
export function critical_path(phases: Telemetry_phase[]): Set<string> {
	const by = new Map(phases.map((p) => [p.name, p]));
	const done = phases.filter((p) => p.end_ms != null);
	if (!done.length) return new Set();
	let cur: Telemetry_phase | undefined = done.reduce((a, b) => ((b.end_ms ?? 0) > (a.end_ms ?? 0) ? b : a));
	const out = new Set<string>();
	while (cur && !out.has(cur.name)) {
		out.add(cur.name);
		const deps: Telemetry_phase[] = cur.depends_on.map((d) => by.get(d)).filter((p): p is Telemetry_phase => Boolean(p && p.end_ms != null));
		cur = deps.length ? deps.reduce((a, b) => ((b.end_ms ?? 0) > (a.end_ms ?? 0) ? b : a)) : undefined;
	}
	return out;
}

/** Layer phases for the DAG: depth = longest dependency chain. */
export function dag_layers(phases: Telemetry_phase[]): Array<Telemetry_phase[]> {
	const names = new Set(phases.map((p) => p.name));
	const depth = new Map<string, number>();
	const by = new Map(phases.map((p) => [p.name, p]));
	const visit = (n: string, stack: Set<string>): number => {
		if (depth.has(n)) return depth.get(n)!;
		if (stack.has(n)) return 0;
		stack.add(n);
		const deps = (by.get(n)?.depends_on ?? []).filter((d) => names.has(d));
		const d = deps.length ? Math.max(...deps.map((x) => visit(x, stack) + 1)) : 0;
		stack.delete(n);
		depth.set(n, d);
		return d;
	};
	phases.forEach((p) => visit(p.name, new Set()));
	const layers: Array<Telemetry_phase[]> = [];
	for (const p of phases) (layers[depth.get(p.name) ?? 0] ??= []).push(p);
	return layers.filter(Boolean);
}

/** Cost per phase split by model, from the bars (Hub-priced, token-share estimate per agent). */
export function phase_model_costs(t: Run_telemetry_data): Array<{ phase: string; total: number; parts: Array<{ model: string; cost: number }> }> {
	const rows = new Map<string, Map<string, number>>();
	for (const b of t.bars) {
		if (b.cost_usd == null || b.cost_usd <= 0) continue;
		const m = rows.get(b.phase) ?? new Map<string, number>();
		m.set(b.model ?? 'other', (m.get(b.model ?? 'other') ?? 0) + b.cost_usd);
		rows.set(b.phase, m);
	}
	// Phases priced by the Hub but without per-agent bars still show.
	for (const p of t.phases) if (p.cost_usd && !rows.has(p.name)) rows.set(p.name, new Map([['other', p.cost_usd]]));
	return t.phases.filter((p) => rows.has(p.name)).map((p) => {
		const parts = [...rows.get(p.name)!.entries()].map(([model, cost]) => ({ model, cost }));
		return { phase: p.name, total: parts.reduce((a, x) => a + x.cost, 0), parts };
	});
}

export function by_agent_csv(t: Run_telemetry_data): string {
	const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
	const head = ['agent', 'phase', 'kind', 'runs', 'duration_ms', 'unit_kind', 'units_in', 'units_out', 'cost_usd', 'failures', 'outcome'];
	return [head.join(','), ...t.by_agent.map((a) => head.map((k) => esc((a as Record<string, unknown>)[k])).join(','))].join('\n');
}

/** A folded stretch of the timeline: nothing but waiting between `start_ms` and `end_ms`. */
export interface Folded_gap { start_ms: number; end_ms: number }

/** Where times sit on the timeline (0–1), with long waits folded into short gaps. */
export interface Time_scale {
	/** Position of a time, 0 (start) – 1 (end). */
	x: (ms: number) => number;
	/** The time at a position (for drag-to-zoom). */
	t: (x: number) => number;
	gaps: Folded_gap[];
}

/** A folded gap's share of the work time on screen. */
const GAP_SHARE = 0.06;

/**
 * Lay out [a, b]: with `fold`, every stretch of at least `min_gap_ms` in which no work interval
 * runs (only waiting on people, queueing or nothing) shrinks to a short gap, so the work gets
 * the width; without it, time is linear.
 */
export function time_scale(a: number, b: number, work: Array<[number, number]>, fold: boolean, min_gap_ms = 3 * 60_000): Time_scale {
	const span = Math.max(1, b - a);
	const linear: Time_scale = { x: (ms) => (ms - a) / span, t: (x) => a + x * span, gaps: [] };
	if (!fold) return linear;
	const merged: Array<[number, number]> = [];
	for (const [s, e] of work.map(([s, e]): [number, number] => [Math.max(a, s), Math.min(b, e)]).filter(([s, e]) => e > s).sort((p, q) => p[0] - q[0])) {
		const last = merged[merged.length - 1];
		if (last && s <= last[1]) last[1] = Math.max(last[1], e); else merged.push([s, e]);
	}
	const gaps: Folded_gap[] = [];
	let cur = a;
	for (const [s, e] of merged) { if (s - cur >= min_gap_ms) gaps.push({ start_ms: cur, end_ms: s }); cur = Math.max(cur, e); }
	if (b - cur >= min_gap_ms && merged.length) gaps.push({ start_ms: cur, end_ms: b });
	const folded = gaps.reduce((n, g) => n + (g.end_ms - g.start_ms), 0);
	const shown = span - folded;
	if (!gaps.length || shown <= 0) return linear;
	const G = shown * GAP_SHARE;
	const total = shown + gaps.length * G;
	const v = (ms: number) => {
		let out = ms - a;
		for (const g of gaps) {
			const len = g.end_ms - g.start_ms;
			if (ms <= g.start_ms) break;
			if (ms >= g.end_ms) out -= len - G;
			else { out = out - (ms - g.start_ms) + G * ((ms - g.start_ms) / len); break; }
		}
		return out;
	};
	const t = (x: number) => {
		let target = Math.min(1, Math.max(0, x)) * total;
		let real = a;
		for (const g of gaps) {
			const before = g.start_ms - real;
			if (target <= before) return real + target;
			target -= before;
			if (target <= G) return g.start_ms + (target / G) * (g.end_ms - g.start_ms);
			target -= G;
			real = g.end_ms;
		}
		return Math.min(b, real + target);
	};
	return { x: (ms) => v(ms) / total, t, gaps };
}
