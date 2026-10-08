/**
 * Graphite log viewer for one run — `POST /v1/runs/get_logs` (single Core
 * resource, paged and tailed; not a composition).
 *
 * A run's sub-team runs log under their own run ids: with `sub_runs` the view reads them in the
 * same call (`run_ids`), tags their lines, and can narrow to one run.
 *
 * Newest first. Live tail polls with `since_ms` while the run is live;
 * "Load older" pages with `until_ms`. Search + level filters are server-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_poll } from '@/lib/use_poll';
import { api_message } from '@/lib/use_bff_read';

export interface G_log_line {
	id: string;
	created_at: number;
	level: string;
	message: string;
	concern?: string | null;
	run_id?: string;
}

/** A sub-team run whose logs can be shown with its parent's. */
export interface G_log_source {
	run_id: string;
	/** Short label, e.g. the sub-team's name. */
	label: string;
}

export const LOG_PAGE_SIZE = 200;
export const LOG_TAIL_MS = 4_000;
const LEVELS = ['error', 'warn', 'info', 'debug'] as const;

function level_color(level: string): string {
	const l = level.toLowerCase();
	if (l === 'error' || l === 'fatal') return 'var(--g-bad)';
	if (l === 'warn' || l === 'warning') return 'var(--g-warn-text)';
	if (l === 'debug' || l === 'trace') return 'var(--g-ink-3)';
	return 'var(--g-run)';
}

function clock(ms: number): string {
	const d = new Date(ms);
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function dedupe(lines: G_log_line[]): G_log_line[] {
	const seen = new Set<string>();
	return lines.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
}

export function G_run_logs({ run_id, realm_id, live, initial_query, sub_runs = [] }: { run_id: string; realm_id: string; live: boolean; initial_query?: string; sub_runs?: G_log_source[] }) {
	const auth_fetch = useAuthFetch();
	const [lines, set_lines] = useState<G_log_line[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [older_loading, set_older_loading] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const [q, set_q] = useState(initial_query ?? '');
	const [query, set_query] = useState(initial_query ?? '');
	const [levels, set_levels] = useState<string[]>([]);
	/** 'all' = this run and its sub-teams; else one run id. */
	const [source, set_source] = useState<string>('all');
	const sub_key = sub_runs.map((r) => r.run_id).join(',');
	const run_ids = source === 'all' ? [run_id, ...sub_runs.map((r) => r.run_id)] : [source];
	const run_ids_key = run_ids.join(',');
	const label_of = new Map(sub_runs.map((r) => [r.run_id, r.label]));
	const lines_ref = useRef<G_log_line[]>([]);
	lines_ref.current = lines;

	const body = useCallback((extra: Record<string, unknown>) => {
		const b: Record<string, unknown> = { realm_id, run_ids: run_ids_key.split(','), limit: LOG_PAGE_SIZE, offset: 0, ...extra };
		if (query) b.q = query;
		if (levels.length) b.levels = levels;
		return JSON.stringify(b);
	}, [realm_id, run_ids_key, query, levels]);

	const fetch_logs = useCallback(async (extra: Record<string, unknown>) => {
		const res = await auth_fetch('/v1/runs/get_logs', { method: 'POST', body: body(extra) });
		const data = await res.json().catch(() => null);
		if (!res.ok || !data?.ok) throw new Error(api_message(data, 'Could not load logs.'));
		return { lines: (data.lines ?? data.data?.lines ?? []) as G_log_line[], total: Number(data.total ?? data.data?.total ?? 0) };
	}, [auth_fetch, body]);

	useEffect(() => {
		let cancelled = false;
		set_loading(true);
		fetch_logs({})
			.then((r) => { if (!cancelled) { set_lines(r.lines); set_total(r.total); set_error(null); } })
			.catch((e: Error) => { if (!cancelled) set_error(e.message); })
			.finally(() => { if (!cancelled) set_loading(false); });
		return () => { cancelled = true; };
	}, [fetch_logs]);

	const tail = useCallback(async () => {
		const newest = lines_ref.current[0]?.created_at;
		if (!newest) return;
		try {
			const r = await fetch_logs({ since_ms: newest + 1 });
			if (r.lines.length) {
				set_lines((prev) => dedupe([...r.lines, ...prev]).slice(0, 2000));
				if (r.total) set_total(r.total);
			}
		} catch { /* tail is best-effort */ }
	}, [fetch_logs]);

	use_poll(() => void tail(), LOG_TAIL_MS, live && !loading);

	async function load_older() {
		const oldest = lines[lines.length - 1]?.created_at;
		if (!oldest) return;
		set_older_loading(true);
		try {
			const r = await fetch_logs({ until_ms: oldest - 1 });
			set_lines((prev) => dedupe([...prev, ...r.lines]));
		} catch (e) {
			set_error((e as Error).message);
		} finally {
			set_older_loading(false);
		}
	}

	const toggle_level = (l: string) => set_levels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" data-testid="g-run-logs">
			<div className="flex flex-wrap items-center gap-2 border-b border-[var(--g-line)] px-3 py-2">
				<form
					className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2"
					onSubmit={(e) => { e.preventDefault(); set_query(q.trim()); }}
					role="search"
				>
					<Search aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
					<input
						value={q}
						onChange={(e) => set_q(e.target.value)}
						placeholder="Search logs… (Enter)"
						aria-label="Search logs"
						className="h-7 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--g-ink-3)]"
					/>
				</form>
				<div className="flex gap-1" role="group" aria-label="Log levels">
					{LEVELS.map((l) => (
						<button
							key={l}
							type="button"
							aria-pressed={levels.includes(l)}
							onClick={() => toggle_level(l)}
							className={`rounded-full border px-2 py-0.5 text-[11.5px] ${levels.includes(l) ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}
						>
							{l}
						</button>
					))}
				</div>
				{sub_key ? (
					<div className="flex flex-wrap gap-1" role="group" aria-label="Log source">
						{[['all', 'All'], [run_id, 'This run'], ...sub_runs.map((r) => [r.run_id, `⤷ ${r.label}`])].map(([id, label]) => (
							<button
								key={id}
								type="button"
								aria-pressed={source === id}
								onClick={() => set_source(id)}
								className={`rounded-full border px-2 py-0.5 text-[11.5px] ${source === id ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}
							>
								{label}
							</button>
						))}
					</div>
				) : null}
				<span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--g-ink-3)]">
					{live ? <><span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--g-run)]" />live · </> : null}
					{lines.length} of {total}
				</span>
			</div>
			<div className="g-mono min-h-[240px] flex-1 overflow-auto py-1 text-[12px] leading-[1.55]">
				{loading ? <p className="px-3 py-4 text-[var(--g-ink-3)]">Loading logs…</p> : null}
				{!loading && error ? <p role="alert" className="px-3 py-4 text-[var(--g-bad)]">{error}</p> : null}
				{!loading && !error && lines.length === 0 ? (
					<p className="px-3 py-4 text-[var(--g-ink-3)]">{query || levels.length ? 'No lines match these filters.' : 'No log lines yet.'}</p>
				) : null}
				{lines.map((l) => (
					<div key={l.id} className="grid grid-cols-[72px_46px_minmax(0,1fr)] gap-2 px-3 hover:bg-[var(--g-soft)]" data-testid="log-line">
						<span className="text-[var(--g-ink-3)]">{clock(l.created_at)}</span>
						<span className="uppercase" style={{ color: level_color(l.level) }}>{l.level.slice(0, 5)}</span>
						<span className="whitespace-pre-wrap break-words text-[var(--g-ink-2)]">
							{source === 'all' && l.run_id && label_of.has(l.run_id) ? <span data-testid="log-source" className="mr-1.5 rounded bg-[var(--g-soft)] px-1 text-[10.5px] text-[var(--g-ink-3)]">⤷ {label_of.get(l.run_id)}</span> : null}
							{l.message}
						</span>
					</div>
				))}
				{!loading && lines.length > 0 && lines.length < total ? (
					<button type="button" onClick={() => void load_older()} disabled={older_loading} className="mx-3 my-2 rounded-md border border-[var(--g-line)] px-3 py-1 text-[12px] text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] disabled:opacity-50">
						{older_loading ? 'Loading…' : 'Load older'}
					</button>
				) : null}
			</div>
		</div>
	);
}
