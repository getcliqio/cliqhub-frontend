import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { FileText, Users } from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { List_refresh_button } from '@/components/ui/list_refresh_button';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { PAGE_HELP } from '@/lib/page_help';
import {
	build_teams_search_params,
	normalize_teams_limit,
	normalize_teams_offset,
	parse_scope_filter,
} from '@/lib/teams_filters';

interface TeamRow {
	name: string;
	scope: string | null;
	description: string;
	latest_version: string;
	install_count: number;
	tags: string[];
	listed?: boolean;
}

interface ScopeGroup {
	slug: string;
	display_name: string;
	scope_type: 'user' | 'org';
	visibility: 'public' | 'private';
	teams: TeamRow[];
}

interface DraftRow {
	id: string;
	title: string;
	updated_at: string;
}

interface FlatTeam extends TeamRow {
	scope_slug: string;
	scope_display: string;
}

export function Component() {
	const auth_fetch = useOrgFetch();
	const navigate = useNavigate();
	const [search_params, set_search_params] = useSearchParams();

	const q_filter = search_params.get('q')?.trim() ?? '';
	const scope_filter = useMemo(
		() => parse_scope_filter(search_params.get('scope')),
		[search_params],
	);
	const offset = normalize_teams_offset(search_params.get('offset'));
	const page_limit = normalize_teams_limit(search_params.get('limit')) ?? PAGE_LIMIT;

	const [q_draft, set_q_draft] = useState(q_filter);
	const [scope_groups, set_scope_groups] = useState<ScopeGroup[]>([]);
	const [drafts, set_drafts] = useState<DraftRow[]>([]);
	const [loading, set_loading] = useState(true);
	const [page_error, set_page_error] = useState<string | null>(null);
	const [deleting, set_deleting] = useState<string | null>(null);

	useEffect(() => {
		set_q_draft(q_filter);
	}, [q_filter]);

	useEffect(() => {
		if (q_draft === q_filter) return;
		const t = window.setTimeout(() => {
			const next = build_teams_search_params({
				q: q_draft,
				scopes: scope_filter,
				limit: page_limit,
				offset: 0,
			});
			set_search_params(next, { replace: true });
		}, 300);
		return () => window.clearTimeout(t);
	}, [q_draft, q_filter, scope_filter, page_limit, set_search_params]);

	const load_data = useCallback(async () => {
		set_page_error(null);
		set_loading(true);
		try {
			const teams_body: Record<string, unknown> = {
				mine: true,
				group_by_scope: true,
			};
			if (q_filter) teams_body.query = q_filter;

			const [teams_res, drafts_res] = await Promise.all([
				auth_fetch('/v1/teams/get', {
					method: 'POST',
					body: JSON.stringify(teams_body),
				}),
				auth_fetch('/v1/teams/get', {
					method: 'POST',
					body: JSON.stringify({ mine: true, status: 'draft' }),
				}),
			]);
			const [teams_data, drafts_data] = await Promise.all([
				teams_res.json(),
				drafts_res.json(),
			]);
			if (!teams_data.ok) {
				set_page_error(teams_data.error?.message || 'Failed to load teams');
				return;
			}
			set_scope_groups(teams_data.data.scopes ?? []);
			if (drafts_data.ok) {
				const draft_teams = (drafts_data.data.teams ?? []) as Array<{
					id?: string; name: string; updated_at?: string;
				}>;
				set_drafts(draft_teams.map((t) => ({
					id: t.id || t.name,
					title: t.name,
					updated_at: t.updated_at || '',
				})));
			}		} catch {
			set_page_error('Network error — could not load data');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, q_filter]);

	useEffect(() => {
		void load_data();
	}, [load_data]);

	const scope_facets = useMemo(
		() => scope_groups.map((sg) => ({
			slug: sg.slug,
			label: `@${sg.slug}`,
			count: sg.teams.length,
		})),
		[scope_groups],
	);

	const flat_teams = useMemo(() => {
		const rows: FlatTeam[] = [];
		for (const sg of scope_groups) {
			if (scope_filter.length > 0 && !scope_filter.includes(sg.slug)) continue;
			for (const team of sg.teams) {
				rows.push({
					...team,
					scope_slug: sg.slug,
					scope_display: sg.display_name,
				});
			}
		}
		rows.sort((a, b) => {
			const sa = a.scope_slug.localeCompare(b.scope_slug);
			if (sa !== 0) return sa;
			return a.name.localeCompare(b.name);
		});
		return rows;
	}, [scope_groups, scope_filter]);

	const page_rows = useMemo(
		() => flat_teams.slice(offset, offset + page_limit),
		[flat_teams, offset, page_limit],
	);
	const total = flat_teams.length;

	function list_params(patch: {
		q?: string;
		scopes?: string[];
		offset?: number;
		limit?: number;
	}): URLSearchParams {
		return build_teams_search_params({
			q: patch.q ?? q_filter,
			scopes: patch.scopes ?? scope_filter,
			offset: patch.offset ?? offset,
			limit: patch.limit ?? page_limit,
		});
	}

	function toggle_scope(slug: string) {
		const next = scope_filter.includes(slug)
			? scope_filter.filter((s) => s !== slug)
			: [...scope_filter, slug];
		set_search_params(list_params({ scopes: next, offset: 0 }), { replace: true });
	}

	function clear_filters() {
		set_q_draft('');
		set_search_params(build_teams_search_params({ limit: page_limit }), { replace: true });
	}

	async function handle_delete_draft(id: string) {
		set_deleting(`draft-${id}`);
		try {
			const res = await auth_fetch('/v1/teams/delete', {
				method: 'POST',
				body: JSON.stringify({ team_id: id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_page_error(data.error?.message || 'Failed to delete draft');
				return;
			}
			set_drafts((prev) => prev.filter((d) => d.id !== id));
		} catch {
			set_page_error('Network error — could not delete draft');
		} finally {
			set_deleting(null);
		}
	}

	const has_filters = Boolean(q_filter) || scope_filter.length > 0;
	const showing_from = total === 0 ? 0 : offset + 1;
	const showing_to = Math.min(offset + page_rows.length, total);

	const crumb_items = useMemo(() => {
		if (scope_filter.length === 1) {
			return [
				{ label: 'Teams', to: '/teams' },
				{ label: `@${scope_filter[0]}` },
			];
		}
		return [{ label: 'Teams' }];
	}, [scope_filter]);

	return (
		<div>
			<Breadcrumbs items={crumb_items} />

			{loading && scope_groups.length === 0 && drafts.length === 0 ? (
				<div className="flex min-h-[40vh] items-center justify-center">
					<p className="text-sm text-slate-400">Loading...</p>
				</div>
			) : (
			<>
			<PageHeader
				icon={Users}
				tone="violet"
				title="Teams"
				description="Browse your teams by scope, open a team for details, or install it into a realm."
				help={PAGE_HELP.teams.help}
				docs_href={PAGE_HELP.teams.docs_href}
				actions={(
					<Link
						to="/builder"
						className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
					>
						Build a Team
					</Link>
				)}
			/>

			<div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/50">
					<p className="text-xs font-bold uppercase tracking-wider text-slate-500">Filters</p>
					<p className="text-xs font-semibold text-slate-600">
						{loading
							? 'Loading…'
							: total === 0
								? '0 teams'
								: `Showing ${showing_from}–${showing_to} of ${total}`}
					</p>
				</div>
				<div className="space-y-3 p-4">
					<div className="flex items-center gap-2">
						<input
							value={q_draft}
							onChange={(e) => set_q_draft(e.target.value)}
							placeholder="Search teams…"
							aria-label="Search teams"
							className="w-full flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800"
						/>
						<List_refresh_button
							on_click={() => { void load_data(); }}
							busy={loading}
							label="Refresh teams"
						/>
					</div>
					{scope_facets.length > 0 ? (
						<div>
							<p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
								Scope
							</p>
							<div className="flex flex-wrap gap-2">
								{scope_facets.map((facet) => {
									const active = scope_filter.includes(facet.slug);
									return (
										<button
											key={facet.slug}
											type="button"
											onClick={() => toggle_scope(facet.slug)}
											className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
												active
													? 'bg-indigo-600 text-white'
													: 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
											}`}
										>
											{facet.label}
											<span className={`ml-1.5 ${active ? 'text-indigo-100' : 'text-slate-400'}`}>
												{facet.count}
											</span>
										</button>
									);
								})}
							</div>
						</div>
					) : null}
					{has_filters ? (
						<div className="flex flex-wrap items-center gap-2">
							{q_filter ? (
								<span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
									search: {q_filter}
								</span>
							) : null}
							{scope_filter.map((s) => (
								<span
									key={s}
									className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700"
								>
									@{s}
								</span>
							))}
							<button
								type="button"
								onClick={clear_filters}
								className="text-xs font-semibold text-slate-500 hover:text-slate-800"
							>
								Clear
							</button>
						</div>
					) : null}
				</div>
			</div>

			<ApiErrorBanner error={page_error} onDismiss={() => set_page_error(null)} className="mb-3" />

			{drafts.length > 0 ? (
				<section className="mb-4 overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-500/5">
					<div className="flex items-center gap-2 border-b border-amber-200/60 px-4 py-2.5 dark:border-amber-500/20">
						<FileText className="h-3.5 w-3.5 text-amber-700" />
						<span className="text-sm font-bold text-amber-900 dark:text-amber-200">Drafts</span>
						<span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
							{drafts.length}
						</span>
					</div>
					<table className="w-full text-sm">
						<tbody className="divide-y divide-amber-100/80 dark:divide-amber-500/10">
							{drafts.map((draft) => (
								<tr key={draft.id} className="hover:bg-amber-50/60 dark:hover:bg-amber-500/10">
									<td className="px-4 py-2.5">
										<Link
											to={`/drafts/${draft.id}`}
											className="font-mono text-xs font-bold text-indigo-700 hover:underline"
										>
											{draft.title}
										</Link>
									</td>
									<td className="px-4 py-2.5 text-right text-[11px] text-slate-500">
										{new Date(draft.updated_at).toLocaleDateString()}
									</td>
									<td className="px-4 py-2.5 text-right">
										<button
											type="button"
											onClick={() => void handle_delete_draft(draft.id)}
											disabled={deleting === `draft-${draft.id}`}
											className="text-[10px] font-semibold text-red-500 hover:text-red-700 disabled:opacity-50"
										>
											Delete
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			) : null}

			<div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
				{page_rows.length === 0 ? (
					<p className="px-5 py-10 text-center text-sm text-slate-400">
						{has_filters ? 'No teams match these filters.' : 'No teams yet — build one to get started.'}
					</p>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
								<th className="px-4 py-2.5">Team</th>
								<th className="px-4 py-2.5">Scope</th>
								<th className="px-4 py-2.5">Description</th>
								<th className="px-4 py-2.5">Version</th>
								<th className="px-4 py-2.5">Status</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50 dark:divide-slate-800">
							{page_rows.map((team) => {
								const team_key = `${team.scope_slug}/${team.name}`;
								const detail_url = `/teams/${team.scope_slug}/${team.name}`;
								const is_listed = team.listed !== false;
								return (
									<tr
										key={team_key}
										className="cursor-pointer transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
										onClick={() => navigate(detail_url)}
									>
										<td className="px-4 py-3">
											<span className="font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300">
												{team.name}
											</span>
										</td>
										<td className="px-4 py-3">
											<button
												type="button"
												className="font-mono text-xs font-medium text-slate-600 hover:text-indigo-700"
												onClick={(e) => {
													e.stopPropagation();
													toggle_scope(team.scope_slug);
												}}
											>
												@{team.scope_slug}
											</button>
										</td>
										<td className="px-4 py-3">
											<p className="max-w-[18rem] truncate text-xs text-slate-500" title={team.description || undefined}>
												{team.description || '—'}
											</p>
										</td>
										<td className="whitespace-nowrap px-4 py-3">
											{team.latest_version ? (
												<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
													v{team.latest_version}
												</span>
											) : (
												<span className="text-xs text-slate-300">—</span>
											)}
										</td>
										<td className="px-4 py-3">
											<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
												is_listed
													? 'bg-emerald-50 text-emerald-700'
													: 'bg-slate-100 text-slate-500'
											}`}>
												{is_listed ? 'Listed' : 'Unlisted'}
											</span>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
				<Pagination
					total={total}
					offset={offset}
					limit={page_limit}
					on_change={(next_offset) => {
						set_search_params(list_params({ offset: next_offset }), { replace: true });
					}}
					on_limit_change={(n) => {
						set_search_params(list_params({ limit: n, offset: 0 }), { replace: true });
					}}
					label="teams"
				/>
			</div>
			</>
			)}
		</div>
	);
}
