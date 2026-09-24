import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useOrgFetch, useOrg } from '@/lib/org_context';
import { useHubActivity } from '@/lib/hub_activity_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import { Realm_wizard } from '@/components/realm_wizard';
import { PAGE_HELP } from '@/lib/page_help';
import { format_date } from '@/lib/format_time';
import {
	build_realms_get_body,
	build_realms_search_params,
	next_sort_state,
	normalize_limit,
	normalize_offset,
	normalize_owned_filter,
	normalize_sort_by,
	normalize_sort_dir,
	type Realm_owned_filter,
	type Realm_sort_by,
} from '@/lib/realms_filters';
import { Map } from 'lucide-react';
import { realm_qualified_label } from '@/lib/realm_url';

interface RealmRow {
	id: string;
	slug: string;
	org_slug: string | null;
	name: string;
	owner_user_id?: string | null;
	created_by: string;
	created_by_username?: string | null;
	created_at: number | string;
	updated_at: number | string;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function Sort_th({
	label,
	column,
	sort_by,
	sort_dir,
	on_sort,
	class_name = '',
}: {
	label: string;
	column: Realm_sort_by;
	sort_by: Realm_sort_by;
	sort_dir: 'asc' | 'desc';
	on_sort: (column: Realm_sort_by) => void;
	class_name?: string;
}) {
	const active = sort_by === column;
	const marker = !active ? '' : sort_dir === 'asc' ? ' ↑' : ' ↓';
	return (
		<th className={`px-4 py-2.5 ${class_name}`}>
			<button
				type="button"
				onClick={() => on_sort(column)}
				aria-label={`Sort by ${label}`}
				className={`inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-slate-700 ${
					active ? 'text-slate-700' : 'text-slate-400'
				}`}
				aria-sort={active ? (sort_dir === 'asc' ? 'ascending' : 'descending') : 'none'}
			>
				{label}
				{marker}
			</button>
		</th>
	);
}

function Realm_row({
	realm,
	is_default,
	creator,
}: {
	realm: RealmRow;
	is_default: boolean;
	creator: string;
}) {
	const navigate = useNavigate();
	return (
		<tr
			className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
			onClick={() => navigate(`/o/${realm.org_slug ?? 'unknown'}/realms/${realm.slug}`)}
		>
			<td className="px-4 py-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-semibold text-slate-900">{realm.name}</span>
					{is_default ? (
						<span className="rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
							Default
						</span>
					) : null}
				</div>
				<p className="mt-0.5 font-mono text-[11px] text-slate-400">{realm_qualified_label(realm.org_slug, realm.slug)}</p>
			</td>
			<td className="px-4 py-3 font-mono text-xs text-slate-600">{creator}</td>
			<td className="px-4 py-3 text-xs text-slate-500">{format_date(realm.created_at)}</td>
		</tr>
	);
}

export function Component() {
	const auth_fetch = useOrgFetch();
	const { current_id: current_org_id } = useOrg();
	const { default_realm_slug, default_org_slug } = useHubActivity();
	const [search_params, set_search_params] = useSearchParams();
	const create_open = search_params.get('create') === '1';
	const q_filter = search_params.get('q') ?? '';
	const owned_filter = normalize_owned_filter(search_params.get('owned'));
	const sort_by = normalize_sort_by(search_params.get('sort'));
	const sort_dir = normalize_sort_dir(search_params.get('dir'));
	const offset = normalize_offset(search_params.get('offset'));
	const limit = normalize_limit(search_params.get('limit')) ?? PAGE_LIMIT;

	const [realms, set_realms] = useState<RealmRow[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [q_draft, set_q_draft] = useState(q_filter);
	const [owned_draft, set_owned_draft] = useState<Realm_owned_filter>(owned_filter);

	useEffect(() => {
		set_q_draft(q_filter);
		set_owned_draft(owned_filter);
	}, [q_filter, owned_filter]);

	const list_params = useCallback(
		(overrides: {
			q?: string;
			owned?: string;
			sort_by?: string;
			sort_dir?: string;
			offset?: number;
			limit?: number;
			create?: boolean;
		} = {}) =>
			build_realms_search_params({
				q: overrides.q ?? q_filter,
				owned: overrides.owned ?? owned_filter,
				sort_by: overrides.sort_by ?? sort_by,
				sort_dir: overrides.sort_dir ?? sort_dir,
				offset: overrides.offset ?? offset,
				limit: overrides.limit ?? limit,
				create: overrides.create,
			}),
		[q_filter, owned_filter, sort_by, sort_dir, offset, limit],
	);

	const load_realms = useCallback(async () => {
		set_loading(true);
		try {
			const body = build_realms_get_body({
				q: q_filter,
				owned: owned_filter,
				sort_by,
				sort_dir,
				limit,
				offset,
				org_id: current_org_id ?? undefined,
			});

			const res = await auth_fetch('/v1/realms/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (data.ok) {
				set_realms(data.realms ?? []);
				set_total(typeof data.total === 'number' ? data.total : (data.realms ?? []).length);
				set_error(null);
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Failed to load realms');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, q_filter, owned_filter, sort_by, sort_dir, offset, limit, current_org_id]);

	useEffect(() => {
		void load_realms();
	}, [load_realms]);

	function open_create() {
		set_search_params(list_params({ create: true }), { replace: false });
		set_error(null);
	}

	function close_create() {
		set_search_params(list_params({ create: false }), { replace: true });
		set_error(null);
	}

	function clear_filter_key(key: 'q' | 'owned') {
		const q = key === 'q' ? '' : q_filter;
		const owned = key === 'owned' ? '' : owned_filter;
		set_q_draft(q);
		set_owned_draft(owned as Realm_owned_filter);
		set_search_params(list_params({ q, owned, offset: 0 }), { replace: true });
	}

	function clear_all_filters() {
		set_q_draft('');
		set_owned_draft('');
		set_search_params(
			build_realms_search_params({
				sort_by,
				sort_dir,
			}),
			{ replace: true },
		);
	}

	function set_sort(column: Realm_sort_by) {
		const next = next_sort_state(sort_by, sort_dir, column);
		set_search_params(
			list_params({ sort_by: next.sort_by, sort_dir: next.sort_dir, offset: 0 }),
			{ replace: true },
		);
	}

	function set_page_offset(next_offset: number) {
		set_search_params(list_params({ offset: next_offset }), { replace: true });
	}

	function set_page_limit(next_limit: number) {
		// Snap back to the first page so the user sees results start
		// from the top on a size change.
		set_search_params(list_params({ limit: next_limit, offset: 0 }), { replace: true });
	}

	const active_pills = useMemo(() => {
		const pills: { key: 'q' | 'owned'; label: string }[] = [];
		if (q_filter) pills.push({ key: 'q', label: `search: ${q_filter}` });
		if (owned_filter === 'me') pills.push({ key: 'owned', label: 'owned: me' });
		if (owned_filter === 'default') pills.push({ key: 'owned', label: 'owned: default' });
		return pills;
	}, [q_filter, owned_filter]);

	const has_filters = active_pills.length > 0;
	const showing_from = total === 0 ? 0 : offset + 1;
	const showing_to = Math.min(offset + realms.length, total);

	if (create_open) {
		return (
			<div>
				<Breadcrumbs
					items={[
						{ label: 'Realms', to: '/realms' },
						{ label: 'Create' },
					]}
				/>
				<Realm_wizard
					on_cancel={close_create}
					on_done={() => {
						// Refresh the list in the background — the wizard
						// navigates the user straight into the new realm.
						void load_realms();
					}}
				/>
			</div>
		);
	}

	return (
		<div>
			<Breadcrumbs items={[{ label: 'Realms' }]} />

			<PageHeader
				icon={Map}
				tone="sky"
				title="Realms"
				description="Open a realm to manage teams, runs, daemons, tokens, and notifications."
				help={PAGE_HELP.realms.help}
				docs_href={PAGE_HELP.realms.docs_href}
				actions={(
					<button
						type="button"
						onClick={open_create}
						className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
					>
						Create realm
					</button>
				)}
			/>

			<div className="mb-4 overflow-hidden rounded-lg border-b border-slate-100">
				<div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
					<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Filters</p>
					<p className="text-xs font-medium text-slate-500">
						{loading
							? 'Loading…'
							: total === 0
								? '0 realms'
								: `Showing ${showing_from}–${showing_to} of ${total}`}
					</p>
				</div>
			<div className="grid gap-3 px-1 py-3 sm:grid-cols-2 lg:grid-cols-4">
				<label className="text-xs font-semibold text-slate-600 sm:col-span-2">
					Search
					<input
						value={q_draft}
						onChange={(e) => {
							const q = e.target.value;
							set_q_draft(q);
							set_search_params(list_params({ q: q.trim(), offset: 0 }), { replace: true });
						}}
						placeholder="Slug or name"
						aria-label="Filter realms by slug or name"
						className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
					/>
				</label>
				<label className="text-xs font-semibold text-slate-600">
					Ownership
					<select
						value={owned_draft}
						onChange={(e) => {
							const owned = normalize_owned_filter(e.target.value);
							set_owned_draft(owned);
							set_search_params(list_params({ owned, offset: 0 }), { replace: true });
						}}
						aria-label="Filter by ownership"
						className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
					>
						<option value="">All realms</option>
						<option value="me">Owned by me</option>
						<option value="default">Default personal</option>
					</select>
				</label>
				{has_filters ? (
					<div className="flex items-end">
						<button
							type="button"
							onClick={clear_all_filters}
							className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
						>
							Clear
						</button>
					</div>
				) : null}
			</div>
				{has_filters ? (
					<div className="flex flex-wrap gap-2 px-1 pt-2">
						{active_pills.map((p) => (
							<button
								key={p.key}
								type="button"
								onClick={() => clear_filter_key(p.key)}
								className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100"
							>
								{p.label}
								<span aria-hidden>×</span>
							</button>
						))}
					</div>
				) : null}
			</div>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{loading ? (
				<div className="flex min-h-[40vh] items-center justify-center">
					<p className="text-sm text-slate-400">Loading realms...</p>
				</div>
			) : null}

			{!loading && realms.length === 0 ? (
				<div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
					{has_filters ? (
						<p className="text-slate-400">No realms match these filters.</p>
					) : null}
					{!has_filters && default_realm_slug ? (
						<div className="space-y-3">
							<p className="text-slate-600">
								Your personal default realm is ready.
							</p>
							<Link
								to={`/o/${default_org_slug}/realms/${default_realm_slug}`}
								className="inline-block rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
							>
								Open default realm
							</Link>
						</div>
					) : null}
					{!has_filters && !default_realm_slug ? (
						<p className="text-slate-400">No realms yet.</p>
					) : null}
				</div>
			) : null}

			{!loading && realms.length > 0 ? (
				<>
				<div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
					<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
									<Sort_th
										label="Realm"
										column="name"
										sort_by={sort_by}
										sort_dir={sort_dir}
										on_sort={set_sort}
									/>
									<Sort_th
										label="Created by"
										column="created_by"
										sort_by={sort_by}
										sort_dir={sort_dir}
										on_sort={set_sort}
									/>
								<Sort_th
									label="Created"
									column="created_at"
									sort_by={sort_by}
									sort_dir={sort_dir}
									on_sort={set_sort}
								/>
								</tr>
					</thead>
					<tbody className="divide-y divide-slate-50 dark:divide-slate-800">
						{realms.map((realm) => {
							const is_default =
								Boolean(default_realm_slug)
								&& realm.slug.trim().toLowerCase() === default_realm_slug!.trim().toLowerCase();
								const creator = realm.created_by_username
									? `@${realm.created_by_username}`
									: realm.created_by;
								return (
									<Realm_row
										key={realm.id}
										realm={realm}
										is_default={is_default}
										creator={creator}
									/>
								);
							})}
						</tbody>
						</table>
					</div>
					<Pagination
						total={total}
						offset={offset}
						limit={limit}
						on_change={set_page_offset}
						on_limit_change={set_page_limit}
						label="realms"
					/>
				</>
			) : null}
		</div>
	);
}
