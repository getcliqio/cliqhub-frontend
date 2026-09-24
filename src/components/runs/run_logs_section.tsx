import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ArrowUp,
	ChevronDown,
	Loader2,
	Pause,
	RefreshCw,
	Search as SearchIcon,
	X,
} from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { useTheme } from '@/lib/theme_context';
import { use_poll } from '@/lib/use_poll';

/** ------------------------------------------------------------------ */
/** Types                                                                */
/** ------------------------------------------------------------------ */

interface Log_line {
	id: string;
	run_id: string;
	created_at: number;
	level: string;
	message: string;
	daemon_id: string | null;
	daemon_name?: string | null;
	workspace_id: string | null;
	workspace_name?: string | null;
	team: string | null;
	realm_id: string | null;
	concern: string | null;
}

interface Facet_bucket {
	value: string;
	label?: string;
	count: number;
}

interface Facets_data {
	level?: Facet_bucket[];
	daemon_id?: Facet_bucket[];
	team?: Facet_bucket[];
	run_id?: Facet_bucket[];
	workspace_id?: Facet_bucket[];
	concern?: Facet_bucket[];
}

/**
 * Chip options for the concern strip above the log viewer. `'all'` is
 * a UI convenience — an empty concern filter set means "show all".
 */
type Concern_chip = 'all' | 'run' | 'command';
const CONCERN_CHIPS: readonly { key: Concern_chip; label: string }[] = [
	{ key: 'all', label: 'All' },
	{ key: 'run', label: 'Run' },
	{ key: 'command', label: 'Commands' },
];

export interface Run_logs_phase_ref {
	phase: string;
	started_at?: number | null;
	dispatched_at?: number | null;
	completed_at?: number | null;
	status?: string;
}

interface Run_logs_section_props {
	run_id: string;
	realm_id: string;
	/** Poll while the run is still live. */
	live?: boolean;
	/** Phase rows (if any) — used to build a "filter by phase" dropdown. */
	phases?: readonly Run_logs_phase_ref[];
	/** Controlled phase filter (phase name). */
	phase_filter?: string;
	on_phase_filter_change?: (phase: string) => void;
}

/** ------------------------------------------------------------------ */
/** Constants                                                            */
/** ------------------------------------------------------------------ */

const PAGE_SIZE = 200;
const TAIL_LIMIT = 500;
const LIVE_INTERVAL_MS = 3_000;
const SEARCH_DEBOUNCE_MS = 250;
/**
 * Upper bound on DOM-rendered log lines. Runs can have hundreds of thousands
 * of entries; we keep the client responsive by capping the rendered list to
 * the newest N and asking the user to narrow via search / phase / level
 * filters instead of scrolling forever.
 */
const MAX_RENDERED_LINES = 5_000;

type Level_key = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'log';

const LEVEL_LIGHT: Record<Level_key, string> = {
	error: 'text-rose-600',
	warn: 'text-amber-600',
	info: 'text-sky-700',
	debug: 'text-slate-400',
	trace: 'text-slate-400',
	log: 'text-slate-700',
};

const LEVEL_DARK: Record<Level_key, string> = {
	error: 'text-rose-300',
	warn: 'text-amber-300',
	info: 'text-sky-300',
	debug: 'text-slate-500',
	trace: 'text-slate-500',
	log: 'text-slate-300',
};

const LEVEL_TAG: Record<Level_key, string> = {
	error: 'ERR',
	warn: 'WRN',
	info: 'INF',
	debug: 'DBG',
	trace: 'TRC',
	log: '   ',
};

const LEVEL_CHIP: Record<Level_key, { on: string; off: string }> = {
	error: {
		on: 'border-rose-300 bg-rose-50 text-rose-700',
		off: 'border-slate-200 bg-white text-rose-600 hover:bg-rose-50',
	},
	warn: {
		on: 'border-amber-300 bg-amber-50 text-amber-700',
		off: 'border-slate-200 bg-white text-amber-600 hover:bg-amber-50',
	},
	info: {
		on: 'border-sky-300 bg-sky-50 text-sky-700',
		off: 'border-slate-200 bg-white text-sky-600 hover:bg-sky-50',
	},
	debug: {
		on: 'border-slate-300 bg-slate-100 text-slate-700',
		off: 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
	},
	trace: {
		on: 'border-slate-300 bg-slate-100 text-slate-700',
		off: 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
	},
	log: {
		on: 'border-slate-300 bg-slate-100 text-slate-700',
		off: 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
	},
};

const AGENT_PREFIX_RE = /^\[([A-Za-z0-9][A-Za-z0-9_.\-]*)(?:\/[A-Za-z]+)?\]/;

/** ------------------------------------------------------------------ */
/** Helpers                                                              */
/** ------------------------------------------------------------------ */

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function to_level_key(raw: string | null | undefined): Level_key {
	const v = (raw ?? '').toLowerCase();
	if (v === 'error' || v === 'err' || v === 'fatal') return 'error';
	if (v === 'warn' || v === 'warning') return 'warn';
	if (v === 'info') return 'info';
	if (v === 'debug' || v === 'dbg') return 'debug';
	if (v === 'trace') return 'trace';
	return 'log';
}

function format_time_of_day(ms: number): string {
	const d = new Date(ms);
	const hh = d.getHours().toString().padStart(2, '0');
	const mm = d.getMinutes().toString().padStart(2, '0');
	const ss = d.getSeconds().toString().padStart(2, '0');
	const mmm = d.getMilliseconds().toString().padStart(3, '0');
	return `${hh}:${mm}:${ss}.${mmm}`;
}

function extract_agent(message: string): string | null {
	const m = AGENT_PREFIX_RE.exec(message);
	return m ? m[1] : null;
}

function dedupe_by_id(lines: Log_line[]): Log_line[] {
	const seen = new Set<string>();
	const out: Log_line[] = [];
	for (const l of lines) {
		if (seen.has(l.id)) continue;
		seen.add(l.id);
		out.push(l);
	}
	return out;
}

function cap_newest(lines: Log_line[], max: number): Log_line[] {
	if (lines.length <= max) return lines;
	// `lines` is stored newest-first, so slicing from the top keeps the newest.
	return lines.slice(0, max);
}

/** ------------------------------------------------------------------ */
/** Component                                                            */
/** ------------------------------------------------------------------ */

/**
 * Datadog-style log viewer for a single run. Uses the structured
 * `/v1/runs/get_logs` (get_logs) endpoint (newest-first) so filtering, search,
 * pagination, level facets, and live-tail are all server-driven.
 *
 * - Ordering: newest at the top.
 * - Pagination: cursor-style via `until_ms` (Load older).
 * - Live tail: while `live`, polls with `since_ms > newest.created_at`.
 * - Filters: server-side `q`, `levels`, and (via phase timing) time range.
 *   `agent` is derived per-line from a `[agent]` prefix and applied client-side.
 */
export function Run_logs_section({
	run_id,
	realm_id,
	live = false,
	phases,
	phase_filter: phase_filter_prop,
	on_phase_filter_change,
}: Run_logs_section_props) {
	const auth_fetch = useOrgFetch();
	const { resolved: theme } = useTheme();
	const dark = theme === 'dark';

	const [lines, set_lines] = useState<Log_line[]>([]);
	const [pending_lines, set_pending_lines] = useState<Log_line[]>([]);
	const [total, set_total] = useState(0);
	const [facet_levels, set_facet_levels] = useState<Facet_bucket[]>([]);
	const [facet_concerns, set_facet_concerns] = useState<Facet_bucket[]>([]);
	const [concern_chip, set_concern_chip] = useState<Concern_chip>('all');
	const [loading, set_loading] = useState(true);
	const [loading_more, set_loading_more] = useState(false);
	const [refreshing, set_refreshing] = useState(false);
	const [error, set_error] = useState<string | null>(null);

	const [search_input, set_search_input] = useState('');
	const [search, set_search] = useState('');
	const [selected_levels, set_selected_levels] = useState<Set<string>>(new Set());
	const [phase_filter_internal, set_phase_filter_internal] = useState<string>('');
	const phase_controlled = phase_filter_prop !== undefined;
	const phase_filter = phase_controlled ? (phase_filter_prop ?? '') : phase_filter_internal;
	function set_phase_filter(next: string) {
		if (phase_controlled) on_phase_filter_change?.(next);
		else set_phase_filter_internal(next);
	}
	const [agent_filter, set_agent_filter] = useState<string>('');

	const [wrap, set_wrap] = useState(true);
	const [live_enabled, set_live_enabled] = useState<boolean>(live);
	const [is_at_top, set_is_at_top] = useState(true);

	const scroller_ref = useRef<HTMLDivElement | null>(null);
	const is_at_top_ref = useRef(true);
	is_at_top_ref.current = is_at_top;

	useEffect(() => {
		if (live) set_live_enabled(true);
	}, [live]);

	// Debounce search input -> search query
	useEffect(() => {
		const t = setTimeout(() => set_search(search_input), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [search_input]);

	const levels_arr = useMemo(() => [...selected_levels], [selected_levels]);
	const levels_key = levels_arr.slice().sort().join(',');

	const active_phase_row = useMemo(() => {
		if (!phase_filter || !phases) return null;
		return phases.find((p) => p.phase === phase_filter) ?? null;
	}, [phase_filter, phases]);

	const phase_since_ms = active_phase_row?.started_at ?? active_phase_row?.dispatched_at ?? null;
	const phase_until_ms = active_phase_row?.completed_at ?? null;

	const build_search_body = useCallback(
		(overrides: { since_ms?: number; until_ms?: number; offset?: number; limit?: number }) => {
			const body: Record<string, unknown> = {
				realm_id,
				run_ids: [run_id],
				limit: overrides.limit ?? PAGE_SIZE,
				offset: overrides.offset ?? 0,
			};
			const q = search.trim();
			if (q) body.q = q;
			if (levels_arr.length > 0) body.levels = levels_arr;
			const since = overrides.since_ms ?? (phase_since_ms ?? undefined);
			const until = overrides.until_ms ?? (phase_until_ms ?? undefined);
			if (typeof since === 'number') body.since_ms = since;
			if (typeof until === 'number') body.until_ms = until;
			return body;
		},
		[realm_id, run_id, search, levels_arr, phase_since_ms, phase_until_ms],
	);

	// --- Initial + filter-change load ---
	const reload = useCallback(
		async (opts?: { silent?: boolean }) => {
			if (!run_id || !realm_id) return;
			if (!opts?.silent) set_loading(true);
			try {
				const res = await auth_fetch('/v1/runs/get_logs', {
					method: 'POST',
					body: JSON.stringify(build_search_body({ offset: 0 })),
				});
				const data = await res.json();
				if (!data.ok) {
					set_error(api_error_message(data));
					return;
				}
				set_lines((data.lines ?? []) as Log_line[]);
				set_pending_lines([]);
				set_total(Number(data.total ?? 0));
				const facets = (data.facets ?? {}) as Facets_data;
				set_facet_levels(facets.level ?? []);
				set_facet_concerns(facets.concern ?? []);
				set_error(null);
				// After a fresh load the scroller resets to the top.
				requestAnimationFrame(() => {
					if (scroller_ref.current) scroller_ref.current.scrollTop = 0;
				});
			} catch {
				set_error('Failed to load logs');
			} finally {
				if (!opts?.silent) set_loading(false);
			}
		},
		[auth_fetch, run_id, realm_id, build_search_body],
	);

	useEffect(() => {
		void reload();
	}, [reload]);

	async function manual_refresh() {
		set_refreshing(true);
		try {
			await reload({ silent: true });
		} finally {
			set_refreshing(false);
		}
	}

	// --- Live tail: fold arrivals into `lines` if user is at top, else
	//     buffer them into `pending_lines` and let the user opt in with the
	//     "N new lines" pill. ---
	const tail = useCallback(async () => {
		if (!run_id || !realm_id) return;
		const newest_visible = lines[0]?.created_at;
		const newest_pending = pending_lines[0]?.created_at;
		const newest = Math.max(newest_visible ?? 0, newest_pending ?? 0);
		if (!newest) return;
		try {
			const res = await auth_fetch('/v1/runs/get_logs', {
				method: 'POST',
				body: JSON.stringify(build_search_body({ since_ms: newest + 1, limit: TAIL_LIMIT })),
			});
			const data = await res.json();
			if (!data.ok) return;
			const incoming = (data.lines ?? []) as Log_line[];
			if (incoming.length === 0) return;
			if (typeof data.total === 'number') set_total(data.total);
			if (is_at_top_ref.current) {
				set_lines((prev) =>
					cap_newest(dedupe_by_id([...incoming, ...prev]), MAX_RENDERED_LINES),
				);
				requestAnimationFrame(() => {
					if (scroller_ref.current) scroller_ref.current.scrollTop = 0;
				});
			} else {
				set_pending_lines((prev) => dedupe_by_id([...incoming, ...prev]));
			}
		} catch {
			/* live-tail is best-effort */
		}
	}, [auth_fetch, run_id, realm_id, build_search_body, lines, pending_lines]);

	use_poll(
		() => void tail(),
		LIVE_INTERVAL_MS,
		live_enabled && Boolean(run_id) && Boolean(realm_id),
	);

	function jump_to_newest() {
		if (pending_lines.length > 0) {
			set_lines((prev) =>
				cap_newest(dedupe_by_id([...pending_lines, ...prev]), MAX_RENDERED_LINES),
			);
			set_pending_lines([]);
		}
		if (scroller_ref.current) scroller_ref.current.scrollTop = 0;
	}

	function on_scroll(e: React.UIEvent<HTMLDivElement>) {
		const at_top = e.currentTarget.scrollTop <= 4;
		if (at_top !== is_at_top) set_is_at_top(at_top);
		if (at_top && pending_lines.length > 0) {
			set_lines((prev) =>
				cap_newest(dedupe_by_id([...pending_lines, ...prev]), MAX_RENDERED_LINES),
			);
			set_pending_lines([]);
		}
	}

	// --- Load older (cursor via until_ms) ---
	const load_older = useCallback(async () => {
		if (loading_more || lines.length === 0) return;
		const oldest = lines[lines.length - 1]?.created_at;
		if (typeof oldest !== 'number') return;
		set_loading_more(true);
		try {
			const res = await auth_fetch('/v1/runs/get_logs', {
				method: 'POST',
				body: JSON.stringify(build_search_body({ until_ms: oldest - 1, offset: 0 })),
			});
			const data = await res.json();
			if (!data.ok) return;
			const older = (data.lines ?? []) as Log_line[];
			if (older.length === 0) return;
			set_lines((prev) =>
				cap_newest(dedupe_by_id([...prev, ...older]), MAX_RENDERED_LINES),
			);
		} catch {
			/* ignore */
		} finally {
			set_loading_more(false);
		}
	}, [auth_fetch, build_search_body, lines, loading_more]);

	// --- Filters / helpers ---
	function toggle_level(lvl: string) {
		set_selected_levels((prev) => {
			const next = new Set(prev);
			if (next.has(lvl)) next.delete(lvl);
			else next.add(lvl);
			return next;
		});
	}

	function clear_filters() {
		set_selected_levels(new Set());
		set_search_input('');
		set_search('');
		set_phase_filter('');
		set_agent_filter('');
		set_concern_chip('all');
	}

	async function copy_visible() {
		const body = lines
			.slice()
			.reverse()
			.map((l) => `[${format_time_of_day(l.created_at)}] ${l.level.toUpperCase()} ${l.message}`)
			.join('\n');
		try {
			await navigator.clipboard.writeText(body);
		} catch {
			/* ignore */
		}
	}

	// --- Derived (post-fetch) ---
	const agent_options = useMemo(() => {
		const seen = new Set<string>();
		const order: string[] = [];
		for (const l of lines) {
			const a = extract_agent(l.message);
			if (a && !seen.has(a)) {
				seen.add(a);
				order.push(a);
			}
		}
		return order;
	}, [lines]);

	const visible_lines = useMemo(() => {
		let out = lines;
		if (concern_chip !== 'all') {
			// Rows persisted before the migration carry `concern === null` —
			// treat those as 'run' so the default view isn't empty for
			// historical runs.
			out = out.filter((l) => (l.concern ?? 'run') === concern_chip);
		}
		if (agent_filter) {
			out = out.filter((l) => extract_agent(l.message) === agent_filter);
		}
		return out;
	}, [lines, agent_filter, concern_chip]);

	const filters_active =
		selected_levels.size > 0 ||
		search.trim() !== '' ||
		phase_filter !== '' ||
		agent_filter !== '' ||
		concern_chip !== 'all';

	const concern_counts = useMemo(() => {
		const map = new Map<string, number>();
		for (const b of facet_concerns) map.set(b.value, b.count);
		// Fall back to the total when the server hasn't reported any
		// concern buckets yet (all-null legacy rows). Keeps the "All"
		// chip honest instead of showing 0.
		const bucketed = [...map.values()].reduce((s, n) => s + n, 0);
		const all = bucketed > 0 ? bucketed : total;
		return {
			all,
			run: map.get('run') ?? (bucketed === 0 ? total : 0),
			command: map.get('command') ?? 0,
		} as Record<Concern_chip, number>;
	}, [facet_concerns, total]);

	const has_more = lines.length < total;

	const container_class = dark
		? 'bg-slate-950 text-slate-300'
		: 'bg-white text-slate-700';
	const gutter_class = dark ? 'text-slate-500' : 'text-slate-400';
	const level_class = dark ? LEVEL_DARK : LEVEL_LIGHT;
	const row_hover = dark ? 'hover:bg-white/5' : 'hover:bg-slate-50';

	const facet_level_buckets = useMemo(() => {
		return facet_levels
			.filter((b) => b.value)
			.slice()
			.sort((a, b) => b.count - a.count);
	}, [facet_levels]);

	return (
		<section
			id="logs"
			className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white scroll-mt-24 dark:border-slate-800 dark:bg-slate-900"
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
				<div>
					<p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
						Logs · this run
					</p>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						{loading
							? 'Loading…'
							: total === 0
								? 'No log lines yet.'
								: `${visible_lines.length.toLocaleString()} shown${
										total > lines.length ? ` · ${total.toLocaleString()} total` : ''
									} · newest first${
										lines.length >= MAX_RENDERED_LINES
											? ` · capped at ${MAX_RENDERED_LINES.toLocaleString()}`
											: ''
									}`}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => set_live_enabled((v) => !v)}
						title={live_enabled ? 'Pause live tail' : 'Resume live tail'}
						aria-pressed={live_enabled}
						className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
							live_enabled
								? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300'
								: 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
						}`}
					>
						{live_enabled ? (
							<>
								<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
								Live
							</>
						) : (
							<>
								<Pause className="h-3 w-3" />
								Paused
							</>
						)}
					</button>
					<button
						type="button"
						onClick={() => void manual_refresh()}
						disabled={refreshing}
						aria-label="Refresh logs"
						title="Refresh"
						className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
					>
						<RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
					</button>
					<button
						type="button"
						onClick={() => set_wrap((v) => !v)}
						className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
						title={wrap ? 'Disable wrap' : 'Enable wrap'}
					>
						{wrap ? 'Wrap' : 'Nowrap'}
					</button>
					<button
						type="button"
						onClick={copy_visible}
						disabled={lines.length === 0}
						className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
					>
						Copy
					</button>
				</div>
			</div>

			{total > 0 || filters_active ? (
				<div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
					<div className="relative min-w-[180px] flex-1">
						<SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
						<input
							type="text"
							value={search_input}
							onChange={(e) => set_search_input(e.target.value)}
							placeholder="Search this run's logs…"
							aria-label="Search log messages"
							className="w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-6 text-xs text-slate-700 placeholder-slate-400 focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:placeholder-slate-500"
						/>
						{search_input ? (
							<button
								type="button"
								onClick={() => {
									set_search_input('');
									set_search('');
								}}
								aria-label="Clear search"
								className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
							>
								<X className="h-3 w-3" />
							</button>
						) : null}
					</div>

					<div className="flex flex-wrap items-center gap-1">
						{facet_level_buckets.map((bucket) => {
							const raw = bucket.value;
							const key = to_level_key(raw);
							const on = selected_levels.has(raw);
							const chip = LEVEL_CHIP[key][on ? 'on' : 'off'];
							return (
								<button
									key={raw}
									type="button"
									onClick={() => toggle_level(raw)}
									aria-pressed={on}
									className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip}`}
									title={`${bucket.label ?? raw} — ${bucket.count} lines`}
								>
									{bucket.label ?? LEVEL_TAG[key] ?? raw}
									<span className="ml-0.5 tabular-nums opacity-70">{bucket.count}</span>
								</button>
							);
						})}
					</div>

					{phases && phases.length > 1 ? (
						<select
							value={phase_filter}
							onChange={(e) => set_phase_filter(e.target.value)}
							aria-label="Filter by phase"
							title="Filter by phase"
							className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600 focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-200"
						>
							<option value="">All phases</option>
							{phases.map((p) => (
								<option key={p.phase} value={p.phase}>
									{p.phase}
								</option>
							))}
						</select>
					) : null}

					{agent_options.length > 1 ? (
						<select
							value={agent_filter}
							onChange={(e) => set_agent_filter(e.target.value)}
							aria-label="Filter by agent"
							title="Filter by agent"
							className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600 focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-200"
						>
							<option value="">All agents</option>
							{agent_options.map((a) => (
								<option key={a} value={a}>
									{a}
								</option>
							))}
						</select>
					) : null}

					{filters_active ? (
						<button
							type="button"
							onClick={clear_filters}
							className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100"
						>
							Clear
						</button>
					) : null}
				</div>
			) : null}

			{/* Concern chip strip — always visible when we have any lines
			    to slice, even before the level facet strip appears. */}
			{total > 0 ? (
				<div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-white px-4 py-1.5 dark:border-slate-800 dark:bg-slate-900">
					<span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
						Concern
					</span>
					{CONCERN_CHIPS.map(({ key, label }) => {
						const on = concern_chip === key;
						const count = concern_counts[key] ?? 0;
						return (
							<button
								key={key}
								type="button"
								onClick={() => set_concern_chip(key)}
								aria-pressed={on}
								className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
									on
										? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300'
										: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
								}`}
							>
								{label}
								<span className="tabular-nums opacity-70">{count.toLocaleString()}</span>
							</button>
						);
					})}
				</div>
			) : null}

			{error ? (
				<p className="px-4 py-3 text-sm text-rose-700">{error}</p>
			) : null}

			{loading && lines.length === 0 ? (
				<p className="flex-1 px-4 py-6 text-sm text-slate-400">Loading logs…</p>
			) : lines.length === 0 ? (
				<div className="flex-1 space-y-2 px-4 py-6 text-sm text-slate-500">
					<p className="font-medium text-slate-600">No log lines on Hub for this run yet.</p>
					<ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
						<li>
							Log mirroring is off by default. On the daemon, run{' '}
							<code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700">
								cliq settings hub_connect.sync_logs true
							</code>
							.
						</li>
						<li>
							Full logs still live on the daemon under{' '}
							<code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700">
								~/.cliqrc/logs/runs/
							</code>
							.
						</li>
						<li>If the run just started, wait a moment — live runs refresh automatically.</li>
					</ul>
				</div>
			) : visible_lines.length === 0 ? (
				<p className="flex-1 px-4 py-6 text-sm text-slate-500">
					No lines match the current filters.{' '}
					<button
						type="button"
						onClick={clear_filters}
						className="font-semibold text-sky-600 hover:underline"
					>
						Clear filters
					</button>
				</p>
			) : (
				<>
					<div className="relative flex min-h-0 flex-1 flex-col">
						{pending_lines.length > 0 ? (
							<button
								type="button"
								onClick={jump_to_newest}
								className="pointer-events-auto absolute left-1/2 top-2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100"
								title="Scroll to newest lines"
							>
								<ArrowUp className="h-3 w-3" />
								{pending_lines.length} new{' '}
								{pending_lines.length === 1 ? 'line' : 'lines'}
							</button>
						) : null}
						<div
							ref={scroller_ref}
							onScroll={on_scroll}
							className={`min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed ${container_class}`}
						>
							<ol className="divide-y divide-slate-100/60">
								{visible_lines.map((line) => {
									const level = to_level_key(line.level);
									const time = format_time_of_day(line.created_at);
									return (
										<li
											key={line.id}
											className={`flex gap-3 px-4 py-1 ${row_hover} ${
												wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
											}`}
										>
											<span
												className={`shrink-0 select-none tabular-nums ${gutter_class}`}
												title={new Date(line.created_at).toISOString()}
											>
												{time}
											</span>
											<span
												className={`w-8 shrink-0 select-none text-[10px] font-semibold uppercase ${level_class[level]}`}
											>
												{LEVEL_TAG[level]}
											</span>
											<span className={`min-w-0 flex-1 ${level_class[level]}`}>
												{line.message || '\u00A0'}
											</span>
										</li>
									);
								})}
							</ol>
						</div>
					</div>
					{has_more && !agent_filter ? (
						<div className="flex items-center justify-center border-t border-slate-100 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
							<button
								type="button"
								onClick={() => void load_older()}
								disabled={loading_more}
								className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
							>
								{loading_more ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<ChevronDown className="h-3 w-3" />
								)}
								{loading_more
									? 'Loading…'
									: `Load older (${(total - lines.length).toLocaleString()} more)`}
							</button>
						</div>
					) : null}
				</>
			)}
		</section>
	);
}
