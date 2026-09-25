import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Play } from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import { run_matches_team_filter } from '@/lib/runs_filters';
import {
	team_filter_param,
	type Realm_team_coverage,
} from '@/lib/realm_teams_coverage';
import type { WorkflowPhase } from '@/lib/types';
import { hub_payload } from '@/lib/hub_envelope';

interface Daemon_info {
	id: string;
	name: string | null;
	hostname: string | null;
	status: string;
}

interface Run_row {
	run_id: string;
	run_name?: string | null;
	state?: string | null;
	team_label?: string | null;
	started_at?: number | null;
	last_updated_at?: number | null;
}

interface Team_input_spec {
	name: string;
	description?: string;
}

interface Registry_team {
	description?: string;
	latest_version?: string | null;
	origin?: string;
	inputs?: unknown;
	workflow?: { phases?: WorkflowPhase[]; support?: WorkflowPhase[] };
	agents?: Record<string, unknown>;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function format_relative(ts: number | null | undefined): string {
	if (!ts) return '—';
	const age_s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (age_s < 60) return 'just now';
	if (age_s < 3600) return `${Math.floor(age_s / 60)}m ago`;
	if (age_s < 86400) return `${Math.floor(age_s / 3600)}h ago`;
	if (age_s < 604800) return `${Math.floor(age_s / 86400)}d ago`;
	return new Date(ts).toLocaleDateString();
}

function daemon_status_dot(status: string): string {
	if (status === 'online') return 'bg-emerald-500';
	if (status === 'stale') return 'bg-amber-400';
	return 'bg-slate-300';
}

function coverage_classes(row: Realm_team_coverage): string {
	if (row.online_daemon_count === 0) return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
	if (row.installed_count >= row.online_daemon_count) {
		return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
	}
	if (row.installed_count > 0) {
		return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
	}
	return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
}

function run_state_classes(state: string | null | undefined): string {
	const s = (state ?? '').toLowerCase();
	if (s === 'completed' || s === 'succeeded' || s === 'passed') {
		return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
	}
	if (s === 'running' || s === 'queued' || s === 'pending') {
		return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300';
	}
	if (s === 'failed' || s === 'crashed' || s === 'error') {
		return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
	}
	return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function normalize_inputs(raw: unknown): Team_input_spec[] {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw
			.filter((i: unknown): i is Team_input_spec =>
				!!i
				&& typeof i === 'object'
				&& typeof (i as { name?: unknown }).name === 'string'
				&& !!(i as { name: string }).name.trim(),
			)
			.map((i) => ({
				name: i.name.trim(),
				description: typeof i.description === 'string' ? i.description : undefined,
			}));
	}
	if (typeof raw === 'object') {
		return Object.entries(raw as Record<string, unknown>).map(([name, meta]) => ({
			name,
			description: typeof (meta as { description?: unknown })?.description === 'string'
				? (meta as { description: string }).description
				: undefined,
		}));
	}
	return [];
}

const INPUT_REFERENCE_PATTERNS = [
	/\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
	/\$\(\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\)/g,
	/\$inputs\.([A-Za-z_][A-Za-z0-9_]*)/g,
];

function discover_input_refs(node: unknown, out: Set<string>): void {
	if (!node) return;
	if (typeof node === 'string') {
		for (const re of INPUT_REFERENCE_PATTERNS) {
			re.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = re.exec(node)) !== null) {
				const name = m[1]?.trim();
				if (name) out.add(name);
			}
		}
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) discover_input_refs(item, out);
		return;
	}
	if (typeof node === 'object') {
		for (const v of Object.values(node as Record<string, unknown>)) {
			discover_input_refs(v, out);
		}
	}
}

function merge_inputs(declared: Team_input_spec[], discovered: string[]): Team_input_spec[] {
	const by_name = new Map<string, Team_input_spec>();
	for (const spec of declared) by_name.set(spec.name, spec);
	for (const name of discovered) {
		if (!by_name.has(name)) by_name.set(name, { name });
	}
	return [...by_name.values()];
}

function collect_phases(workflow: Registry_team['workflow'] | undefined): WorkflowPhase[] {
	if (!workflow) return [];
	return [
		...(workflow.phases || []),
		...((workflow.support || []).map((p) => ({ ...p, is_support: true }))),
	];
}

interface Props {
	realm_id: string;
	realm_slug: string;
	realm_name: string;
	scope: string;
	slug: string;
	base_path: string;
}

/**
 * Realm-scoped team Overview — operational detail that the Teams table
 * does not show (description, phases, inputs, install map, recent runs).
 */
export function Realm_team_overview({
	realm_id,
	realm_slug,
	realm_name,
	scope,
	slug,
	base_path,
}: Props) {
	const auth_fetch = useOrgFetch();
	const label = `@${scope}/${slug}`;
	const team_q = team_filter_param(scope, slug);
	const runs_href = `${base_path}/runs?team=${encodeURIComponent(team_q)}`;
	const marketplace_href = `/teams/${encodeURIComponent(scope)}/${encodeURIComponent(slug)}`;

	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [coverage, set_coverage] = useState<Realm_team_coverage | null>(null);
	const [daemons, set_daemons] = useState<Daemon_info[]>([]);
	const [registry, set_registry] = useState<Registry_team | null>(null);
	const [inputs, set_inputs] = useState<Team_input_spec[]>([]);
	const [runs, set_runs] = useState<Run_row[]>([]);
	const [run_open, set_run_open] = useState(false);

	const load = useCallback(async () => {
		set_loading(true);
		set_error(null);
		try {
			const [teams_res, daemons_res, registry_res, runs_res] = await Promise.all([
				auth_fetch('/v1/teams/get', {
					method: 'POST',
					body: JSON.stringify({
						realm_id,
						query: `${scope}/${slug}`,
						limit: 50,
						offset: 0,
					}),
				}),
				auth_fetch('/v1/daemons/get', {
					method: 'POST',
					body: JSON.stringify({ realm_id, limit: 200, offset: 0 }),
				}),
				auth_fetch('/v1/teams/get_by_id', {
					method: 'POST',
					body: JSON.stringify({ scope, name: slug }),
				}),
				auth_fetch('/v1/runs/get', {
					method: 'POST',
					body: JSON.stringify({
						realm_id,
						limit: 40,
						offset: 0,
						sort_by: 'created_at',
						sort_dir: 'desc',
					}),
				}),
			]);

			const teams_data = await teams_res.json();
			if (!teams_data.ok) {
				set_error(api_error_message(teams_data));
				return;
			}
			const payload = teams_data.data ?? teams_data;
			const rows = (payload.rows ?? payload.teams ?? []) as Realm_team_coverage[];
			const match = rows.find((r) =>
				r.scope === scope && r.slug === slug,
			) ?? rows.find((r) =>
				r.label === label || `${r.scope}/${r.slug}` === `${scope}/${slug}`,
			) ?? null;
			set_coverage(match);

			const daemons_data = await daemons_res.json();
			if (daemons_data.ok) {
				set_daemons((daemons_data.daemons ?? []) as Daemon_info[]);
			}

			const registry_data = await registry_res.json();
			let next_registry: Registry_team | null = null;
			let next_inputs: Team_input_spec[] = [];
			if (registry_data.ok && registry_data.data) {
				next_registry = registry_data.data as Registry_team;
				const declared = normalize_inputs(next_registry.inputs);
				const refs = new Set<string>();
				discover_input_refs(next_registry.workflow, refs);
				discover_input_refs(next_registry.agents, refs);
				next_inputs = merge_inputs(declared, [...refs]);
			}
			set_registry(next_registry);

			if (next_inputs.length === 0 && match?.sample_team_id) {
				const cp_res = await auth_fetch('/v1/teams/get_by_id', {
					method: 'POST',
					body: JSON.stringify({ team_id: match.sample_team_id }),
				});
				const cp_data = await cp_res.json();
				if (cp_data.ok) {
					const team = cp_data.data ?? {};
					const declared = normalize_inputs((team as { inputs?: unknown }).inputs);
					const refs = new Set<string>();
					discover_input_refs(team, refs);
					next_inputs = merge_inputs(declared, [...refs]);
				}
			}
			set_inputs(next_inputs);

			const runs_data = await runs_res.json();
			if (runs_data.ok) {
				const page = hub_payload<{ items?: Run_row[] }>(runs_data);
				const raw = Array.isArray(runs_data.data)
					? (runs_data.data as Run_row[])
					: (page?.items ?? []);
				const list = raw
					.filter((r) => run_matches_team_filter(r.team_label, team_q))
					.slice(0, 5);
				set_runs(list);
			}
		} catch {
			set_error('Failed to load team overview');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, realm_id, scope, slug, label, team_q]);

	useEffect(() => {
		void load();
	}, [load]);

	const phases = useMemo(
		() => collect_phases(registry?.workflow),
		[registry],
	);

	const installed_set = useMemo(
		() => new Set(coverage?.installed_daemon_ids ?? []),
		[coverage],
	);

	const is_local = coverage?.origin === 'local';
	const is_realm_member = !is_local && Boolean(coverage?.in_team_list);
	const visible_daemons = is_realm_member
		? daemons
		: daemons.filter((d) => installed_set.has(d.id));

	const hub_version = registry?.latest_version ?? null;
	const installed_version = coverage?.version ?? null;
	const version_drift = Boolean(
		hub_version
		&& installed_version
		&& hub_version !== installed_version,
	);

	if (loading) {
		return <p className="py-8 text-sm text-slate-400">Loading overview…</p>;
	}

	return (
		<div className="space-y-8">
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			<div className="flex flex-wrap items-center gap-3">
				<button
					type="button"
					onClick={() => set_run_open(true)}
					className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-800"
				>
					<Play className="h-3.5 w-3.5" />
					Start run
				</button>
				<Link
					to={runs_href}
					className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-indigo-600 dark:hover:bg-indigo-900/30"
				>
					Open runs
				</Link>
				{!is_local ? (
					<Link
						to={marketplace_href}
						className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-indigo-600 dark:hover:bg-indigo-900/30"
					>
						<ExternalLink className="h-3.5 w-3.5" strokeWidth={2.4} />
						Registry page
					</Link>
				) : null}
			</div>

			<section>
				<h2 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">About</h2>
				{registry?.description ? (
					<p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
						{registry.description}
					</p>
				) : (
					<p className="text-sm italic text-slate-400">
						{is_local
							? 'Local team — no Hub registry description.'
							: 'No description published for this team.'}
					</p>
				)}
				<div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
					<span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
						{is_local ? 'local' : 'published'}
					</span>
					{coverage?.in_team_list ? (
						<span className="rounded-full bg-indigo-100 px-2.5 py-1 font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
							on realm team list
						</span>
					) : (
						<span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
							daemon install only
						</span>
					)}
					{installed_version ? (
						<span className="font-mono text-slate-500 dark:text-slate-400">
							installed v{installed_version}
						</span>
					) : null}
					{hub_version ? (
						<span className="font-mono text-slate-500 dark:text-slate-400">
							hub v{hub_version}
						</span>
					) : null}
					{version_drift ? (
						<span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
							version drift
						</span>
					) : null}
					{coverage ? (
						<span className={`rounded-full px-2.5 py-1 font-bold ${coverage_classes(coverage)}`}>
							{coverage.coverage_label}
						</span>
					) : null}
				</div>
			</section>

			<section>
				<h2 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">
					Pipeline
					{phases.length > 0 ? (
						<span className="ml-1.5 font-normal text-slate-400">({phases.length})</span>
					) : null}
				</h2>
				{phases.length === 0 ? (
					<p className="text-sm italic text-slate-400">No phases available from Hub.</p>
				) : (
					<ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
						{phases.map((phase, idx) => (
							<li
								key={`${phase.name}-${idx}`}
								className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
							>
								<span className="w-5 shrink-0 text-xs font-bold text-slate-400">{idx + 1}</span>
								<span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
									{phase.name}
								</span>
								<span className="text-xs text-slate-400">{phase.type}</span>
								{phase.agent ? (
									<span className="text-xs text-slate-500 dark:text-slate-400">
										agent <span className="font-mono">{phase.agent}</span>
									</span>
								) : null}
								{phase.is_support ? (
									<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">
										support
									</span>
								) : null}
							</li>
						))}
					</ol>
				)}
			</section>

			<section>
				<h2 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">
					Inputs
					{inputs.length > 0 ? (
						<span className="ml-1.5 font-normal text-slate-400">({inputs.length})</span>
					) : null}
				</h2>
				{inputs.length === 0 ? (
					<p className="text-sm italic text-slate-400">No run inputs declared or referenced.</p>
				) : (
					<ul className="space-y-2">
						{inputs.map((spec) => (
							<li key={spec.name} className="text-sm">
								<span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
									{spec.name}
								</span>
								{spec.description ? (
									<span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
										{spec.description}
									</span>
								) : null}
							</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h2 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">
					{is_realm_member ? 'Daemon sync' : 'Installed on'}
				</h2>
				{visible_daemons.length === 0 ? (
					<p className="text-sm italic text-slate-400">No daemon installs in this realm.</p>
				) : (
					<ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
						{visible_daemons.map((d) => {
							const installed = installed_set.has(d.id);
							const display = d.name || d.hostname || d.id.slice(0, 8);
							return (
								<li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
									<span
										className={`h-2 w-2 shrink-0 rounded-full ${daemon_status_dot(d.status)}`}
										title={d.status}
									/>
									<Link
										to={`${base_path}/daemons/${d.id}`}
										className="font-medium text-slate-800 hover:text-indigo-700 hover:underline dark:text-slate-200 dark:hover:text-indigo-300"
									>
										{display}
									</Link>
									<span className="text-[11px] capitalize text-slate-400">{d.status}</span>
									{installed ? (
										<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
											installed
											{installed_version ? ` · v${installed_version}` : ''}
										</span>
									) : (
										<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
											pending install
										</span>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</section>

			<section>
				<div className="mb-2 flex items-baseline justify-between gap-3">
					<h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recent runs</h2>
					<Link
						to={runs_href}
						className="text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
					>
						See all →
					</Link>
				</div>
				{runs.length === 0 ? (
					<p className="text-sm italic text-slate-400">No runs for this team in the realm yet.</p>
				) : (
					<ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
						{runs.map((run) => {
							const when = run.started_at ?? run.last_updated_at ?? null;
							const title = run.run_name?.trim() || run.run_id.slice(0, 8);
							return (
								<li key={run.run_id}>
									<Link
										to={`${base_path}/runs/${run.run_id}`}
										className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
									>
										<span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-200">
											{title}
										</span>
										<span className="flex shrink-0 items-center gap-2">
											<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${run_state_classes(run.state)}`}>
												{run.state || 'unknown'}
											</span>
											<span className="text-xs text-slate-400">{format_relative(when)}</span>
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				)}
			</section>

			{run_open ? (
				<Run_in_realm_dialog
					scope={scope}
					slug={slug}
					fixed_realm={{ id: realm_id, slug: realm_slug, name: realm_name }}
					on_close={() => set_run_open(false)}
				/>
			) : null}
		</div>
	);
}
