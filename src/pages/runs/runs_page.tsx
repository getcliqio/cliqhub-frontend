import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, ArrowUpDown, Play } from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { List_refresh_button } from '@/components/ui/list_refresh_button';
import { format_datetime } from '@/lib/format_time';
import { Pagination } from '@/components/pagination';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import {
	build_runs_search_params,
	display_run_name,
	parse_runs_sort,
	run_matches_team_filter,
	type Runs_sort_by,
} from '@/lib/runs_filters';

/**
 * Parse a `team_label` shaped `@scope/slug` into `{scope, slug}`.
 * Returns null when the label is missing or malformed — caller hides
 * the Run-again action rather than opening a dialog that can't route.
 */
function parse_team_label(label: string | null | undefined): { scope: string; slug: string } | null {
	if (!label) return null;
	const trimmed = label.trim().replace(/^@/, '');
	if (!trimmed.includes('/')) return null;
	const [scope, ...rest] = trimmed.split('/');
	const slug = rest.join('/');
	if (!scope || !slug) return null;
	return { scope, slug };
}

/**
 * Parse a JSON-stringified inputs blob into a plain object. Returns
 * `{}` on null / empty / malformed — the dialog surfaces missing keys
 * as blank required fields rather than silently dispatching stale
 * inputs and eating the Hub validator error.
 */
function parse_row_inputs(raw: string | null | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		const v = JSON.parse(raw);
		return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

interface RunRow {
	run_id: string;
	run_name?: string | null;
	state: string;
	team_label?: string | null;
	daemon_id?: string | null;
	workspace_name?: string | null;
	workspace_dir?: string | null;
	started_at?: number | null;
	completed_at?: number | null;
	last_updated_at?: number | null;
	inputs?: string | null;
}

interface Daemon_option {
	id: string;
	name: string | null;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function status_classes(state: string): string {
	if (state === 'completed' || state === 'done') return 'bg-emerald-50 text-emerald-700';
	if (state === 'failed' || state === 'crashed') return 'bg-red-50 text-red-700';
	if (state === 'running') return 'bg-indigo-50 text-indigo-700';
	if (state === 'awaiting_input') return 'bg-amber-50 text-amber-700';
	return 'bg-slate-100 text-slate-500';
}

function short_id(id: string | null | undefined): string {
	if (!id) return '—';
	if (id.length <= 12) return id;
	return `${id.slice(0, 8)}…`;
}

function format_relative(ts: number | null | undefined): string {
	if (ts === null || ts === undefined) return '—';
	const diff = Date.now() - ts;
	if (diff < 0) return 'in the future';
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.floor(hr / 24);
	if (day < 30) return `${day}d ago`;
	return format_datetime(ts);
}

function Sortable_th({
	label,
	col,
	sort_by,
	sort_dir,
	on_sort,
}: {
	label: string;
	col: Runs_sort_by;
	sort_by: Runs_sort_by;
	sort_dir: 'asc' | 'desc';
	on_sort: (col: Runs_sort_by) => void;
}) {
	const active = sort_by === col;
	const Icon = !active ? ArrowUpDown : sort_dir === 'asc' ? ArrowUp : ArrowDown;
	return (
		<th className="px-4 py-2">
			<button
				type="button"
				onClick={() => on_sort(col)}
				className={`inline-flex items-center gap-1 hover:text-slate-700 ${
					active ? 'text-indigo-600' : ''
				}`}
				aria-sort={!active ? 'none' : sort_dir === 'asc' ? 'ascending' : 'descending'}
			>
				<span>{label}</span>
				<Icon className="h-3 w-3" strokeWidth={2.4} />
			</button>
		</th>
	);
}

export function Component() {
	const { realm, base_path } = useOutletContext<Realm_outlet_context>();
	const auth_fetch = useOrgFetch();
	const navigate = useNavigate();
	const [search_params, set_search_params] = useSearchParams();
	const [runs, set_runs] = useState<RunRow[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [daemons, set_daemons] = useState<Daemon_option[]>([]);
	const [team_options, set_team_options] = useState<string[]>([]);

	const team_filter = search_params.get('team') ?? '';
	const state_filter = search_params.get('state') ?? '';
	const daemon_filter = search_params.get('daemon') ?? '';
	const q_filter = search_params.get('q') ?? '';
	const offset = Math.max(0, Number(search_params.get('offset') ?? '0') || 0);
	const { sort_by, sort_dir } = parse_runs_sort(search_params);
	// Row-level "Run again" now opens the Run_in_realm_dialog prefilled
	// with the row's inputs — same UX as the detail-page "Run again"
	// button, and lets the user see/fill missing inputs (e.g. when the
	// team version has added new required inputs since the prior run).
	const [run_again_target, set_run_again_target] = useState<
		| { scope: string; slug: string; inputs: Record<string, unknown>; run_name: string | null; source_run_id: string }
		| null
	>(null);

	// URL-driven page size — snap to the same set the Pagination component
	// exposes in its selector so a manually-edited URL still lands on a
	// valid value. Default 50 (runs pages tend to want big lists at a
	// glance more than realms/teams do).
	const PAGE_SIZES = [10, 20, 50, 100] as const;
	const PAGE_SIZE_DEFAULT = 50;
	const page_size_raw = Number(search_params.get('limit') ?? '');
	const PAGE_SIZE = (PAGE_SIZES as readonly number[]).includes(page_size_raw)
		? page_size_raw
		: PAGE_SIZE_DEFAULT;

	const [team_draft, set_team_draft] = useState(team_filter);
	const [state_draft, set_state_draft] = useState(state_filter);
	const [daemon_draft, set_daemon_draft] = useState(daemon_filter);
	const [filter_draft, set_filter_draft] = useState(q_filter);

	useEffect(() => {
		set_team_draft(team_filter);
		set_state_draft(state_filter);
		set_daemon_draft(daemon_filter);
		set_filter_draft(q_filter);
	}, [team_filter, state_filter, daemon_filter, q_filter]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await auth_fetch('/v1/daemons/get', {
					method: 'POST',
					body: JSON.stringify({ realm_id: realm.id, limit: 200, offset: 0 }),
				});
				const data = await res.json();
				if (cancelled || !data.ok) return;
				set_daemons((data.daemons ?? []).map((d: { id: string; name?: string | null }) => ({
					id: d.id,
					name: d.name ?? null,
				})));
			} catch {
				/* filter still usable without daemon list */
			}
		})();
		return () => { cancelled = true; };
	}, [auth_fetch, realm.id]);

	const load = useCallback(async () => {
		set_loading(true);
		try {
			// Server-side: query (text), state, daemon, sort. Team filter is a
			// UI-side refinement over the fetched page (server doesn't take
			// team_label directly yet — small enough set of teams that it's
			// fine as a post-filter).
			const body: Record<string, unknown> = {
				limit: PAGE_SIZE,
				offset: team_filter ? 0 : offset,
				realm_id: realm.id,
				sort_by,
				sort_dir,
			};
			if (q_filter.trim()) body.query = q_filter.trim();
			if (state_filter) {
				// Comma-separated states become an array so the dashboard's
				// "Failed" tile can drill into failed+crashed together
				// without the count on the tile disagreeing with the
				// filtered list.
				const parts = state_filter.split(',').map((s) => s.trim()).filter(Boolean);
				body.state = parts.length > 1 ? parts : (parts[0] ?? state_filter);
			}
			if (daemon_filter) body.daemon_id = daemon_filter;

			const res = await auth_fetch('/v1/runs/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			let list: RunRow[] = data.runs ?? [];
			if (team_filter.trim()) {
				list = list.filter((r) => run_matches_team_filter(r.team_label, team_filter));
			}
			set_runs(list);
			set_total(team_filter.trim()
				? list.length
				: Number(data.total ?? list.length));
			const labels = new Set<string>();
			for (const r of (data.runs ?? []) as RunRow[]) {
				const label = (r.team_label ?? '').replace(/^@/, '');
				if (label.includes('/')) labels.add(label);
			}
			set_team_options((prev) => {
				const merged = new Set([...prev, ...labels]);
				if (team_filter.trim()) merged.add(team_filter.trim().replace(/^@/, ''));
				return [...merged].sort();
			});
			set_error(null);
		} catch {
			set_error('Failed to load runs');
		} finally {
			set_loading(false);
		}
	}, [
		auth_fetch, realm.id, offset, PAGE_SIZE, team_filter, state_filter,
		daemon_filter, q_filter, sort_by, sort_dir,
	]);

	useEffect(() => {
		void load();
	}, [load]);


	function apply_filter_now(overrides?: { team?: string; state?: string; daemon?: string; q?: string }) {
		set_search_params(
			build_runs_search_params({
				team: overrides?.team ?? team_draft,
				state: overrides?.state ?? state_draft,
				daemon: overrides?.daemon ?? daemon_draft,
				q: overrides?.q ?? filter_draft,
				sort_by,
				sort_dir,
			}),
			{ replace: true },
		);
	}

	function toggle_sort(next_by: Runs_sort_by) {
		const next = new URLSearchParams(search_params);
		if (sort_by === next_by) {
			// Toggle direction — but if we're at the default sort_by/desc,
			// bump asc; otherwise flip.
			const flipped = sort_dir === 'asc' ? 'desc' : 'asc';
			if (next_by === 'last_updated_at' && flipped === 'desc') next.delete('sort_dir');
			else next.set('sort_dir', flipped);
		} else {
			if (next_by === 'last_updated_at') next.delete('sort_by');
			else next.set('sort_by', next_by);
			next.delete('sort_dir');
		}
		next.delete('offset');
		set_search_params(next, { replace: true });
	}

	/**
	 * Row-level "Run again": open the same dialog the run-detail page
	 * uses, prefilled from the row's inputs. Direct-dispatch was tempting
	 * (one-click restart) but it silently sent stale inputs and got 400s
	 * from Hub's _validate_required_inputs whenever the team version
	 * added a new required input between the original run and now.
	 *
	 * When `team_label` is missing (Hub couldn't JOIN the run's
	 * team_id back to a scope/slug — happens for runs mirrored from a
	 * daemon whose team row got GC'd) we route the click to the run
	 * detail page rather than making the button a dead no-op. The
	 * detail page has its own Run-again path that can start from
	 * whatever richer state it can hydrate, or at minimum lets the
	 * user see why the row is unrouteable.
	 */
	function open_run_again(row: RunRow) {
		const parsed = parse_team_label(row.team_label);
		if (!parsed) {
			navigate(`${base_path}/runs/${row.run_id}`);
			return;
		}
		set_run_again_target({
			scope: parsed.scope,
			slug: parsed.slug,
			inputs: parse_row_inputs(row.inputs),
			run_name: row.run_name ? `${row.run_name} (rerun)` : null,
			source_run_id: row.run_id,
		});
	}

	function clear_filter_key(key: 'team' | 'state' | 'daemon' | 'q') {
		const next = new URLSearchParams(search_params);
		next.delete(key);
		next.delete('offset');
		set_search_params(next, { replace: true });
	}

	function set_offset(next_offset: number) {
		const next = new URLSearchParams(search_params);
		if (next_offset <= 0) next.delete('offset');
		else next.set('offset', String(next_offset));
		set_search_params(next, { replace: true });
	}

	function set_page_size(next_size: number) {
		const next = new URLSearchParams(search_params);
		next.delete('offset');
		if (next_size === PAGE_SIZE_DEFAULT) next.delete('limit');
		else next.set('limit', String(next_size));
		set_search_params(next, { replace: true });
	}

	const active_pills = useMemo(() => {
		const pills: { key: 'team' | 'state' | 'daemon' | 'q'; label: string }[] = [];
		if (team_filter) pills.push({ key: 'team', label: `team: @${team_filter.replace(/^@/, '')}` });
		if (state_filter) {
			// `?state=failed,crashed` from the dashboard tile renders as
			// "status: failed or crashed" — comma is a URL param concept,
			// not something a user should have to read as-is.
			const label = state_filter.includes(',')
				? state_filter.split(',').map((s) => s.trim()).filter(Boolean).join(' or ')
				: state_filter;
			pills.push({ key: 'state', label: `status: ${label}` });
		}
		if (daemon_filter) {
			const d = daemons.find((x) => x.id === daemon_filter);
			pills.push({
				key: 'daemon',
				label: `daemon: ${d?.name || short_id(daemon_filter)}`,
			});
		}
		if (q_filter) pills.push({ key: 'q', label: `search: ${q_filter}` });
		return pills;
	}, [team_filter, state_filter, daemon_filter, q_filter, daemons]);

	const view_team_href = useMemo(() => {
		if (!team_filter) return null;
		const raw = team_filter.replace(/^@/, '');
		const slash = raw.indexOf('/');
		if (slash <= 0) return null;
		return `${base_path}/teams/${encodeURIComponent(raw.slice(0, slash))}/${encodeURIComponent(raw.slice(slash + 1))}`;
	}, [base_path, team_filter]);

	const has_filters = active_pills.length > 0;

	return (
		<div>
			{/* Compact toolbar — tab already names the page */}
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<select
					value={team_draft}
					onChange={(e) => { set_team_draft(e.target.value); apply_filter_now({ team: e.target.value }); }}
					aria-label="Filter by team"
					className="rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-700"
				>
					<option value="">All teams</option>
					{team_options.map((t) => (
						<option key={t} value={t}>@{t}</option>
					))}
					{team_draft && !team_options.includes(team_draft.replace(/^@/, '')) ? (
						<option value={team_draft.replace(/^@/, '')}>
							@{team_draft.replace(/^@/, '')}
						</option>
					) : null}
				</select>
				<select
					value={state_draft}
					onChange={(e) => { set_state_draft(e.target.value); apply_filter_now({ state: e.target.value }); }}
					aria-label="Filter by status"
					className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700"
				>
					<option value="">All statuses</option>
					<option value="running">running</option>
					<option value="awaiting_input">awaiting_input</option>
					<option value="completed">completed</option>
					<option value="failed">failed</option>
					<option value="cancelled">cancelled</option>
					<option value="crashed">crashed</option>
				</select>
				<select
					value={daemon_draft}
					onChange={(e) => { set_daemon_draft(e.target.value); apply_filter_now({ daemon: e.target.value }); }}
					aria-label="Filter by daemon"
					className="rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-700"
				>
					<option value="">All daemons</option>
					{daemons.map((d) => (
						<option key={d.id} value={d.id}>
							{d.name || short_id(d.id)}
						</option>
					))}
				</select>
				<input
					value={filter_draft}
					onChange={(e) => set_filter_draft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							apply_filter_now({ q: (e.target as HTMLInputElement).value });
						}
					}}
					onBlur={(e) => apply_filter_now({ q: e.target.value })}
					placeholder="Search name / id…"
					aria-label="Search runs"
					className="min-w-[10rem] flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-300"
				/>
				<List_refresh_button
					on_click={() => { void load(); }}
					busy={loading}
					label="Refresh runs"
				/>
				{has_filters ? (
					<Link
						to={`${base_path}/runs`}
						className="text-[11px] font-semibold text-slate-400 hover:text-slate-700"
					>
						Clear
					</Link>
				) : null}
				<span className="text-[11px] text-slate-400">
					{loading ? '…' : `${runs.length}${has_filters ? '' : `/${total}`}`}
				</span>
			</div>

			{active_pills.length > 0 ? (
				<div className="mb-2 flex flex-wrap items-center gap-1.5">
					{active_pills.map((p) => (
						<button
							key={p.key}
							type="button"
							onClick={() => clear_filter_key(p.key)}
							className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-800 hover:bg-indigo-100"
						>
							{p.label} <span aria-hidden="true">×</span>
						</button>
					))}
					{view_team_href ? (
						<Link to={view_team_href} className="text-[11px] font-semibold text-indigo-600 hover:underline">
							View team
						</Link>
					) : null}
				</div>
			) : null}

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{loading ? (
				<p className="text-sm text-slate-400">Loading runs…</p>
			) : runs.length === 0 ? (
				<div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
					<p className="text-slate-400">
					{has_filters ? 'No runs match these filters.' : 'No runs on this realm yet.'}
				</p>
				</div>
			) : (
				<div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
					<table className="w-full min-w-[48rem] text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
								<Sortable_th
									label="Run name"
									col="run_name"
									sort_by={sort_by}
									sort_dir={sort_dir}
									on_sort={toggle_sort}
								/>
								<th className="px-4 py-2">Run ID</th>
								<Sortable_th
									label="Team"
									col="team"
									sort_by={sort_by}
									sort_dir={sort_dir}
									on_sort={toggle_sort}
								/>
								<Sortable_th
									label="Status"
									col="state"
									sort_by={sort_by}
									sort_dir={sort_dir}
									on_sort={toggle_sort}
								/>
								<Sortable_th
									label="Started"
									col="started_at"
									sort_by={sort_by}
									sort_dir={sort_dir}
									on_sort={toggle_sort}
								/>
								<Sortable_th
									label="Last update"
									col="last_updated_at"
									sort_by={sort_by}
									sort_dir={sort_dir}
									on_sort={toggle_sort}
								/>
								<th className="px-4 py-2 text-right">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50">
							{runs.map((r) => {
								const team_runs = r.team_label
									? `${base_path}/runs?team=${encodeURIComponent(r.team_label.replace(/^@/, ''))}`
									: null;
								const last = r.last_updated_at ?? r.completed_at ?? r.started_at ?? null;
								const can_rerun = parse_team_label(r.team_label) !== null;
								return (
									<tr key={r.run_id} className="hover:bg-slate-50">
										<td className="px-4 py-3">
											<Link
												to={`${base_path}/runs/${r.run_id}`}
												className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline"
											>
												{display_run_name(r)}
											</Link>
										</td>
										<td
											className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500"
											title={r.run_id}
										>
											<Link
												to={`${base_path}/runs/${r.run_id}`}
												className="text-indigo-600 hover:underline"
											>
												{short_id(r.run_id)}
											</Link>
										</td>
										<td className="px-4 py-3">
											{team_runs ? (
												<Link
													to={team_runs}
													className="font-mono text-xs text-indigo-600 hover:underline"
												>
													{r.team_label}
												</Link>
											) : (
												<span className="text-slate-600">—</span>
											)}
										</td>
										<td className="px-4 py-3">
											<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status_classes(r.state)}`}>
												{r.state}
											</span>
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
											{r.started_at ? format_datetime(r.started_at) : '—'}
										</td>
										<td
											className="whitespace-nowrap px-4 py-3 text-xs text-slate-500"
											title={last ? format_datetime(last) : undefined}
										>
											{last ? format_relative(last) : '—'}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-right">
											<button
												type="button"
												onClick={() => open_run_again(r)}
												title={can_rerun
													? `Run again — opens dialog prefilled from ${display_run_name(r)}`
													: 'Team label missing — opening run detail page'}
												className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
											>
												<Play className="h-3 w-3" strokeWidth={2.4} />
												Run again
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
			{!team_filter ? (
				<Pagination
					total={total}
					offset={offset}
					limit={PAGE_SIZE}
					on_change={set_offset}
					on_limit_change={set_page_size}
					label="runs"
				/>
			) : null}
			{run_again_target ? (
				<Run_in_realm_dialog
					scope={run_again_target.scope}
					slug={run_again_target.slug}
					fixed_realm={{ id: realm.id, slug: realm.slug, name: realm.name }}
					prefill_from={{
						inputs: run_again_target.inputs,
						run_name: run_again_target.run_name,
						source_run_id: run_again_target.source_run_id,
					}}
					on_close={() => {
						set_run_again_target(null);
						void load();
					}}
				/>
			) : null}
		</div>
	);
}
