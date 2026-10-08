/** Realm › Runs — types for `POST /v1/realm_runs/get` and small helpers. */
export interface Realm_run_row {
	run_id: string;
	run_name: string | null;
	team: string | null;
	state: string;
	current_phase: string | null;
	daemon_id: string | null;
	started_at: number | null;
	completed_at: number | null;
	updated_at: number | null;
	error: string | null;
	/** Set on a sub-team run: its main run and the phase that started it (absent from an older BFF). */
	parent?: { run_id: string; run_name: string | null; phase: string | null } | null;
}

/** A runs-list row in display order: `depth` 1+ = under its main run; `subs` = its sub-team rows on the page. */
export interface Nested_run_row { row: Realm_run_row; depth: number; subs: number; parent_on_page: boolean }

/**
 * Order a page of runs so each sub-team run follows its main run (indented), keeping the page's
 * order otherwise. A sub-team run whose main run isn't on this page stays where it is.
 */
export function nest_runs(items: Realm_run_row[]): Nested_run_row[] {
	const ids = new Set(items.map((r) => r.run_id));
	const kids = new Map<string, Realm_run_row[]>();
	for (const r of items) {
		const p = r.parent?.run_id;
		if (p && ids.has(p)) kids.set(p, [...(kids.get(p) ?? []), r]);
	}
	const out: Nested_run_row[] = [];
	const seen = new Set<string>();
	const add = (r: Realm_run_row, depth: number) => {
		if (seen.has(r.run_id)) return;
		seen.add(r.run_id);
		const mine = kids.get(r.run_id) ?? [];
		out.push({ row: r, depth, subs: mine.length, parent_on_page: depth > 0 });
		for (const k of mine) add(k, depth + 1);
	};
	for (const r of items) if (!(r.parent?.run_id && ids.has(r.parent.run_id))) add(r, 0);
	for (const r of items) add(r, 0);
	return out;
}

export interface Realm_runs_data {
	/** Columns the BFF can sort this list by. */
	sortable?: string[];
	realm: { id: string; slug: string; name: string; org_slug: string | null };
	items: Realm_run_row[];
	total: number;
	offset: number;
	limit: number;
	counts: { all: number | null; running: number | null; awaiting_input: number | null; failed_7d: number | null };
	partial: boolean;
}

export type Run_state_filter = 'running' | 'awaiting_input' | 'failed' | 'completed' | 'cancelled';
export type Run_range = '24h' | '7d' | '30d';

export const RANGE_MS: Record<Run_range, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

/** "14m", "1h 05m", "2d 3h" — how long a run took (or has been running). */
export function duration(start: number | null, end: number | null, now: number = Date.now()): string {
	if (!start) return '—';
	const s = Math.max(0, Math.round(((end ?? now) - start) / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
	return `${Math.floor(h / 24)}d ${h % 24}h`;
}
