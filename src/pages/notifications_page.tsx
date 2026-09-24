import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PAGE_HELP } from '@/lib/page_help';
import { useOrgFetch } from '@/lib/org_context';
import { mark_notifications_seen } from '@/lib/use_sidebar_badges';
import { Pagination } from '@/components/pagination';
import { Explorer_shell } from '@/components/explorer/explorer_shell';
import { Facet_sidebar, type Facet_group } from '@/components/explorer/facet_sidebar';
import {
	EXPLORER_PAGE_LIMIT,
	use_explorer_params,
} from '@/components/explorer/use_explorer_params';
import { event_groups_for_scope } from '@/lib/notification_event_catalog';
import { Bell } from 'lucide-react';
import { hub_payload } from '@/lib/hub_envelope';

interface NotificationRow {
	id: string;
	event: string;
	title: string | null;
	message: string | null;
	realm_id: string | null;
	team: string | null;
	run_id: string | null;
	phase: string | null;
	severity: string | null;
	payload?: Record<string, unknown>;
	created_at: number;
}

type Notif_tab = 'inbox';

const FACET_KEYS = ['event', 'severity', 'realm', 'team', 'phase'] as const;

function resolve_tab(raw: string | null): Notif_tab | 'reviews' {
	if (raw === 'reviews') return 'reviews';
	return 'inbox';
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function format_when(created_at: number): string {
	try {
		return new Date(created_at).toLocaleString();
	} catch {
		return String(created_at);
	}
}

function count_by(rows: NotificationRow[], key: keyof NotificationRow): Map<string, number> {
	const map = new Map<string, number>();
	for (const row of rows) {
		const raw = row[key];
		if (raw == null || raw === '') continue;
		const value = String(raw);
		map.set(value, (map.get(value) ?? 0) + 1);
	}
	return map;
}

interface Realm_option {
	id: string;
	slug: string;
	name: string;
}

/** In-app notification inbox (HUG lives under /hug). */
export function Component() {
	const auth_fetch = useOrgFetch();
	const [search_params] = useSearchParams();
	const tab = resolve_tab(search_params.get('tab'));
	const explorer = use_explorer_params(FACET_KEYS);

	const [query_draft, set_query_draft] = useState(explorer.q);
	const [error, set_error] = useState<string | null>(null);
	const [loading, set_loading] = useState(true);
	const [rows, set_rows] = useState<NotificationRow[]>([]);
	const [total, set_total] = useState(0);
	const [realms, set_realms] = useState<Realm_option[]>([]);

	useEffect(() => {
		set_query_draft(explorer.q);
	}, [explorer.q]);

	// Stamp "seen" on the inbox tab so the top-bar bell clears the
	// "N new" badge next poll. Only fires on the inbox tab (HUG's
	// pending count is server-side and doesn't need this).
	useEffect(() => {
		if (tab === 'inbox') mark_notifications_seen();
	}, [tab]);

	// Load realms once so the Realm facet can render (name, slug) and
	// map to the id when calling the API.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await auth_fetch('/v1/realms/get', {
					method: 'POST',
					body: JSON.stringify({ limit: 100 }),
				});
				const data = await res.json();
				if (cancelled || !data.ok) return;
				const list = (data.realms ?? []) as Array<{ id: string; slug: string; name: string | null }>;
				set_realms(list.map((r) => ({
					id: r.id,
					slug: r.slug,
					name: r.name || r.slug,
				})));
			} catch { /* ignore — filter just stays disabled */ }
		})();
		return () => { cancelled = true; };
	}, [auth_fetch]);

	// Realm facet stores slugs (stable, human-readable in URL) but the
	// API takes ids — translate here.
	const selected_realm_ids = useMemo(() => {
		const selected_slugs = explorer.facets.realm ?? new Set<string>();
		const ids: string[] = [];
		for (const r of realms) {
			if (selected_slugs.has(r.slug)) ids.push(r.id);
		}
		return ids;
	}, [explorer.facets.realm, realms]);

	const load = useCallback(async () => {
		if (tab !== 'inbox') return;
		set_loading(true);
		try {
			const body: Record<string, unknown> = {
				limit: EXPLORER_PAGE_LIMIT,
				offset: explorer.offset,
			};
			if (explorer.q.trim()) body.q = explorer.q.trim();
			if (explorer.since_ms != null) body.since_ms = explorer.since_ms;
			if (selected_realm_ids.length > 0) body.realms = selected_realm_ids;
			const events = [...(explorer.facets.event ?? [])];
			if (events.length) body.types = events;
			const severities = [...(explorer.facets.severity ?? [])];
			if (severities.length) body.severities = severities;
			const teams = [...(explorer.facets.team ?? [])];
			if (teams.length) body.teams = teams;
			const phases = [...(explorer.facets.phase ?? [])];
			if (phases.length) body.phases = phases;

			const res = await auth_fetch('/v1/notifications/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			const page = hub_payload<{ items?: NotificationRow[]; total?: number; notifications?: NotificationRow[] }>(data)
				?? data;
			const items = page.items ?? page.notifications ?? [];
			set_rows(items as NotificationRow[]);
			set_total(Number(page.total ?? items.length));
			set_error(null);
		} catch {
			set_error('Failed to load notifications');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, tab, explorer.q, explorer.offset, explorer.since_ms, explorer.facets, selected_realm_ids]);

	useEffect(() => {
		void load();
		/** Auto-refresh every 15 s so new notifications appear without manual action. */
		const id = window.setInterval(() => { void load(); }, 15_000);
		return () => window.clearInterval(id);
	}, [load]);

	const catalog_events = useMemo(() => {
		const groups = [
			...event_groups_for_scope('realm'),
			...event_groups_for_scope('account'),
		];
		const leaves: Array<{ value: string; label: string }> = [];
		for (const g of groups) {
			for (const child of g.children) leaves.push(child);
		}
		return leaves;
	}, []);

	const facet_groups: Facet_group[] = useMemo(() => {
		const event_counts = count_by(rows, 'event');
		const severity_counts = count_by(rows, 'severity');
		const team_counts = count_by(rows, 'team');
		const phase_counts = count_by(rows, 'phase');

		// Realm counts keyed by id, then rendered by slug (URL-stable) with
		// the human name as the label.
		const realm_counts_by_id = count_by(rows, 'realm_id');
		const realm_options = realms
			.map((r) => ({
				value: r.slug,
				label: r.name,
				count: realm_counts_by_id.get(r.id) ?? 0,
			}))
			.filter((o) => o.count > 0 || (explorer.facets.realm?.has(o.value) ?? false));

		return [
			{
				key: 'event',
				title: 'Event',
				options: catalog_events
					.map((e) => ({
						value: e.value,
						label: e.label,
						count: event_counts.get(e.value) ?? 0,
					}))
					.filter((o) => o.count > 0 || (explorer.facets.event?.has(o.value) ?? false))
					.slice(0, 40),
			},
			{
				key: 'realm',
				title: 'Realm',
				options: realm_options,
			},
			{
				key: 'severity',
				title: 'Severity',
				options: [...severity_counts.entries()].map(([value, count]) => ({ value, count })),
			},
			{
				key: 'team',
				title: 'Team',
				options: [...team_counts.entries()].map(([value, count]) => ({ value, count })),
			},
			{
				key: 'phase',
				title: 'Phase',
				options: [...phase_counts.entries()].map(([value, count]) => ({ value, count })),
			},
		];
	}, [rows, catalog_events, realms, explorer.facets.event, explorer.facets.realm]);

	if (tab === 'reviews') {
		return <Navigate to="/hug" replace />;
	}

	return (
		<div>
			<Breadcrumbs items={[{ label: 'Notifications' }]} />
			<PageHeader
				icon={Bell}
				tone="amber"
				title="Notifications"
				description={(
					<>
						In-app deliveries from Hub events. HUG reviews are under{' '}
						<Link to="/hug" className="font-medium text-indigo-600 hover:underline">
							HUG
						</Link>
						. Set alert destinations under each{' '}
						<Link to="/realms" className="font-medium text-indigo-600 hover:underline">
							Realm → Notifications
						</Link>
						.
					</>
				)}
				help={PAGE_HELP.notifications.help}
				docs_href={PAGE_HELP.notifications.docs_href}
			/>

			<div className="mt-6 space-y-4">
				<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />
				<Explorer_shell
					query={query_draft}
					on_query_change={set_query_draft}
					on_submit_query={(value) => explorer.set_q(value)}
					query_placeholder="Search title, message, event…"
					time={explorer.time}
					on_time_change={explorer.set_time}
					on_refresh={() => void load()}
					sidebar={(
						<Facet_sidebar
							groups={facet_groups}
							selected={explorer.facets}
							on_toggle={explorer.toggle_facet}
							on_clear={explorer.clear_facet}
						/>
					)}
				>
					<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
									<th className="px-5 py-2">When</th>
									<th className="px-5 py-2">Event</th>
									<th className="px-5 py-2">Daemon / team</th>
									<th className="px-5 py-2">Run / phase</th>
									<th className="px-5 py-2">Message</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-50">
								{loading ? (
									<tr>
										<td colSpan={5} className="px-5 py-10 text-center text-slate-400">
											Loading…
										</td>
									</tr>
								) : rows.length === 0 ? (
									<tr>
										<td colSpan={5} className="px-5 py-10 text-center text-slate-400">
											No notifications match these filters.
										</td>
									</tr>
								) : (
									rows.map((row) => {
										const run_name = typeof row.payload?.run_name === 'string'
											? row.payload.run_name
											: null;
										const daemon_name = typeof row.payload?.daemon_name === 'string'
											? row.payload.daemon_name
											: null;
										return (
											<tr key={row.id}>
												<td className="whitespace-nowrap px-5 py-3 text-slate-500">
													{format_when(row.created_at)}
												</td>
												<td className="px-5 py-3">
													<code className="text-xs">{row.event}</code>
													{row.severity ? (
														<span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
															{row.severity}
														</span>
													) : null}
												</td>
												<td className="px-5 py-3 text-slate-600">
													{daemon_name ? (
														<span className="font-medium text-slate-800">{daemon_name}</span>
													) : row.realm_id ? (
														<span className="font-mono text-xs">{row.realm_id.slice(0, 8)}…</span>
													) : (
														<span className="text-slate-400">account</span>
													)}
													{row.team ? (
														<span className="mt-0.5 block text-xs text-slate-500">{row.team}</span>
													) : null}
												</td>
												<td className="px-5 py-3 text-slate-600">
													{row.run_id ? (
														<Link
															to={`/runs/${row.run_id}`}
															className="text-xs text-indigo-600 hover:underline"
														>
															{run_name || `${row.run_id.slice(0, 8)}…`}
														</Link>
													) : (
														<span className="text-slate-400">—</span>
													)}
													{row.phase ? (
														<span className="mt-0.5 block text-xs text-slate-500">{row.phase}</span>
													) : null}
												</td>
												<td className="max-w-xs truncate px-5 py-3 text-slate-600">
													{(() => {
														const review_url = typeof row.payload?.review_url === 'string'
															? row.payload.review_url : null;
														const review_id = typeof row.payload?.review_id === 'string'
															? row.payload.review_id : null;
														if (review_url || review_id) {
															const href = review_id ? `/reviews/${review_id}` : review_url!;
															return (
																<Link to={href} className="text-indigo-600 hover:underline">
																	{row.title || row.message || 'Open review'}
																</Link>
															);
														}
														return row.message || row.title || '—';
													})()}
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
					<Pagination
						total={total}
						offset={explorer.offset}
						limit={EXPLORER_PAGE_LIMIT}
						on_change={explorer.set_offset}
					/>
				</Explorer_shell>
			</div>
		</div>
	);
}
