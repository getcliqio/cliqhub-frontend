import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { ApiErrorBanner } from '@/components/ui/api_error';
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
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { Bell } from 'lucide-react';

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
	created_at: number;
}

const FACET_KEYS = ['event', 'severity', 'team', 'phase'] as const;

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

/** Received in-app notifications for this realm. */
export function Component() {
	const { realm, base_path } = useOutletContext<Realm_outlet_context>();
	const auth_fetch = useOrgFetch();
	const explorer = use_explorer_params(FACET_KEYS);

	const [query_draft, set_query_draft] = useState(explorer.q);
	const [error, set_error] = useState<string | null>(null);
	const [loading, set_loading] = useState(true);
	const [rows, set_rows] = useState<NotificationRow[]>([]);
	const [total, set_total] = useState(0);

	useEffect(() => {
		mark_notifications_seen();
	}, []);

	useEffect(() => {
		set_query_draft(explorer.q);
	}, [explorer.q]);

	const load = useCallback(async () => {
		set_loading(true);
		try {
			const body: Record<string, unknown> = {
				limit: EXPLORER_PAGE_LIMIT,
				offset: explorer.offset,
				realm_id: realm.id,
			};
			if (explorer.q.trim()) body.q = explorer.q.trim();
			if (explorer.since_ms != null) body.since_ms = explorer.since_ms;
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
			set_rows((data.notifications ?? []) as NotificationRow[]);
			set_total(Number(data.total ?? (data.notifications ?? []).length));
			set_error(null);
		} catch {
			set_error('Failed to load notifications');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, realm.id, explorer.q, explorer.offset, explorer.since_ms, explorer.facets]);

	useEffect(() => {
		void load();
	}, [load]);

	const catalog_events = useMemo(() => {
		const leaves: Array<{ value: string; label: string }> = [];
		for (const g of event_groups_for_scope('realm')) {
			for (const child of g.children) leaves.push(child);
		}
		return leaves;
	}, []);

	const facet_groups: Facet_group[] = useMemo(() => {
		const event_counts = count_by(rows, 'event');
		const severity_counts = count_by(rows, 'severity');
		const team_counts = count_by(rows, 'team');
		const phase_counts = count_by(rows, 'phase');
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
	}, [rows, catalog_events, explorer.facets.event]);

	return (
		<div>
			<div className="mb-4">
				<div className="flex items-center gap-2">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
						<Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden />
					</span>
					<h2 className="text-lg font-bold text-slate-900">Notifications</h2>
				</div>
				<p className="mt-1 text-sm text-slate-500">
					Messages delivered in-app for this realm. Set where else to send alerts under{' '}
					<Link
						to={`${base_path}/settings/notifications/bindings`}
						className="font-medium text-indigo-600 hover:underline"
					>
						Settings → Alerts
					</Link>
					.
				</p>
			</div>

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
								<th className="px-5 py-2">Team</th>
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
								rows.map((row) => (
									<tr key={row.id} className="hover:bg-slate-50">
										<td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">
											{format_when(row.created_at)}
										</td>
										<td className="px-5 py-3 font-mono text-xs">{row.event}</td>
										<td className="px-5 py-3 text-slate-600">{row.team || '—'}</td>
										<td className="px-5 py-3 font-mono text-xs text-slate-500">
											{row.run_id ? (
												<Link
													to={`${base_path}/runs/${row.run_id}`}
													className="text-indigo-600 hover:underline"
												>
													{(row.run_id).slice(0, 8)}…
												</Link>
											) : (
												'—'
											)}
											{row.phase ? ` / ${row.phase}` : ''}
										</td>
										<td className="max-w-md truncate px-5 py-3 text-slate-700">
											{row.title || row.message || '—'}
										</td>
									</tr>
								))
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
	);
}
