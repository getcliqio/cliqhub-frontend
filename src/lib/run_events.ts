/**
 * A run's event stream (`GET /v1/runs/stream`, replayed then live) turned into
 * what the run page shows: gate route-backs and their reasons, each gate's
 * verdict count, attempts per phase, and a readable feed per phase.
 */
import type { StreamEvent } from '@/hooks/use_run_event_stream';

export interface Run_event {
	id: string;
	type: string;
	phase: string | null;
	agent: string | null;
	payload: Record<string, unknown>;
	at: number;
}

/** A gate sending the run back to an earlier phase. */
export interface Run_route {
	gate: string;
	to: string;
	reason: string | null;
	/** Which verdict of the gate this was (1-based) and how many it may give. */
	iteration: number | null;
	max: number | null;
	at: number;
}

/** A gate's latest verdict: "check 1 / 3". */
export interface Gate_progress {
	iteration: number | null;
	max: number | null;
	outcome: string | null;
	reason: string | null;
}

export type Feed_kind = 'thinking' | 'tool' | 'output' | 'verdict' | 'route' | 'status' | 'error';
export interface Feed_line { id: string; at: number; kind: Feed_kind; title: string; text: string | null }

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Phase names may arrive qualified (`parent.child`); the page shows the local name. */
export function local_phase(phase: string | null): string | null {
	if (!phase) return null;
	const i = phase.lastIndexOf('.');
	return i >= 0 ? phase.slice(i + 1) : phase;
}

export function to_run_event(e: StreamEvent): Run_event {
	let payload: unknown = e.payload;
	if (typeof payload === 'string') {
		try { payload = JSON.parse(payload); } catch { payload = { text: payload }; }
	}
	return { id: String(e.id), type: e.event_type, phase: local_phase(e.phase), agent: e.agent, payload: rec(payload), at: Number(e.timestamp) || 0 };
}

/** Adds events to a list, skipping ones already there (the stream can replay after a reconnect), oldest first. */
export function merge_events(list: Run_event[], add: Run_event[], cap = 3000): Run_event[] {
	const seen = new Set(list.map((e) => e.id));
	const fresh = add.filter((e) => !seen.has(e.id));
	if (!fresh.length) return list;
	const all = [...list, ...fresh].sort((a, b) => a.at - b.at);
	return all.length > cap ? all.slice(all.length - cap) : all;
}

const is_start = (t: string) => t === 'phase.started' || t === 'phase_start' || t === 'phase_started';

export function run_routes(events: Run_event[]): Run_route[] {
	return events.filter((e) => is_start(e.type) && str(e.payload.routed_by) && e.phase).map((e) => ({
		gate: local_phase(str(e.payload.routed_by))!, to: e.phase!, reason: str(e.payload.route_reason),
		iteration: num(e.payload.iteration), max: num(e.payload.max_iterations), at: e.at,
	}));
}

export function gate_progress(events: Run_event[]): Record<string, Gate_progress> {
	const out: Record<string, Gate_progress> = {};
	for (const e of events) {
		if ((e.type !== 'gate_verdict' && e.type !== 'gate_decision') || !e.phase) continue;
		out[e.phase] = { iteration: num(e.payload.iteration), max: num(e.payload.max_iterations), outcome: str(e.payload.outcome), reason: str(e.payload.reason) };
	}
	return out;
}

/** How many times each phase started (a phase sent back by a gate runs again). */
export function phase_attempts(events: Run_event[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const e of events) if (is_start(e.type) && e.phase) out[e.phase] = (out[e.phase] ?? 0) + 1;
	return out;
}

const first_text = (p: Record<string, unknown>, keys: string[]): string | null => {
	for (const k of keys) { const v = str(p[k]); if (v) return v; }
	return null;
};

/** One event as a line of the phase's live feed; null for events not worth a line. */
export function feed_line(e: Run_event): Feed_line | null {
	const p = e.payload;
	const base = { id: e.id, at: e.at };
	switch (e.type) {
		case 'thinking':
			return { ...base, kind: 'thinking', title: 'Thinking', text: first_text(p, ['text', 'content', 'thinking', 'message']) };
		case 'tool_call': {
			const input = rec(p.input ?? p.args ?? p.arguments);
			const what = first_text(input, ['command', 'cmd', 'path', 'file_path', 'file', 'query', 'url', 'pattern']) ?? first_text(p, ['command', 'summary', 'text']);
			return { ...base, kind: 'tool', title: first_text(p, ['name', 'tool', 'tool_name']) ?? 'Tool', text: what };
		}
		case 'llm_output':
			return { ...base, kind: 'output', title: 'Wrote', text: first_text(p, ['text', 'content', 'output', 'message']) };
		case 'gate_verdict':
		case 'gate_decision': {
			const it = num(p.iteration); const mx = num(p.max_iterations);
			return { ...base, kind: 'verdict', title: `Verdict: ${str(p.outcome) ?? 'unknown'}${it && mx ? ` (${it} of ${mx})` : ''}${str(p.target) ? ` → ${str(p.target)}` : ''}`, text: str(p.reason) };
		}
		default:
			if (is_start(e.type)) {
				return str(p.routed_by)
					? { ...base, kind: 'route', title: `Sent back by ${local_phase(str(p.routed_by))}`, text: str(p.route_reason) }
					: { ...base, kind: 'status', title: 'Started', text: null };
			}
			if (e.type === 'phase.completed' || e.type === 'phase_complete' || e.type === 'phase_completed') return { ...base, kind: 'status', title: 'Finished', text: first_text(p, ['summary']) };
			if (e.type === 'phase.failed' || e.type === 'phase_failed' || e.type === 'phase_error' || e.type === 'error') return { ...base, kind: 'error', title: 'Failed', text: first_text(p, ['error', 'message', 'reason']) };
			if (e.type === 'phase.input_required') return { ...base, kind: 'status', title: 'Waiting for input', text: first_text(p, ['message', 'reason']) };
			if (e.type === 'phase.inputs_supplied') return { ...base, kind: 'status', title: 'Input received', text: null };
			if (e.type === 'phase.timed_out') return { ...base, kind: 'error', title: 'Timed out', text: null };
			if (e.type === 'phase.skipped') return { ...base, kind: 'status', title: 'Skipped', text: first_text(p, ['reason']) };
			return null;
	}
}
