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
