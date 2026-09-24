import { Link } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { realm_qualified_label } from '@/lib/realm_url';
import { Pagination } from '@/components/pagination';
import {
	Admin_list_page,
	Admin_search_form,
	api_error_message,
	use_admin_list_query,
	useCallback,
	useEffect,
	useState,
} from '@/pages/admin/admin_list_helpers';

interface DaemonRow {
	id: string;
	name: string | null;
	hostname: string | null;
	status: string;
	last_heartbeat: number | null;
	realms?: Array<{ id: string; slug: string; org_slug: string | null; name: string }>;
}

const LIMIT = 50;

export function Component() {
	const auth_fetch = useAuthFetch();
	const q = use_admin_list_query();
	const [rows, set_rows] = useState<DaemonRow[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);

	const load = useCallback(async () => {
		set_loading(true);
		try {
			const body: Record<string, unknown> = {
				limit: LIMIT,
				offset: q.offset,
				status: undefined,
			};
			if (q.active_query.trim()) body.query = q.active_query.trim();
			const res = await auth_fetch('/v1/daemons/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_rows(data.daemons ?? []);
			set_total(Number(data.total ?? (data.daemons ?? []).length));
			set_error(null);
		} catch {
			set_error('Failed to load daemons');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, q.active_query, q.offset]);

	useEffect(() => { void load(); }, [load]);

	return (
		<Admin_list_page title="All Daemons" subtitle="Every registered daemon across all realms.">
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />
			<Admin_search_form
				filter_draft={q.filter_draft}
				set_filter_draft={q.set_filter_draft}
				on_submit={q.apply_filter}
				placeholder="Filter by hostname or id…"
			/>
			{loading ? (
				<p className="text-sm text-slate-400">Loading…</p>
			) : (
				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
								<th className="px-4 py-2">Daemon</th>
								<th className="px-4 py-2">Status</th>
								<th className="px-4 py-2">Realms</th>
								<th className="px-4 py-2 text-right">Open</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50">
							{rows.map((d) => {
								const realm = d.realms?.[0];
								return (
									<tr key={d.id}>
										<td className="px-4 py-2">
											<p className="font-medium text-slate-800">{d.name || d.hostname || d.id.slice(0, 8)}</p>
											<p className="font-mono text-[10px] text-slate-400">{d.id}</p>
										</td>
										<td className="px-4 py-2 text-xs font-semibold text-slate-600">{d.status}</td>
										<td className="px-4 py-2 text-xs text-slate-500">
											{(d.realms ?? []).map((r) => realm_qualified_label(r.org_slug, r.slug)).join(', ') || '—'}
										</td>
										<td className="px-4 py-2 text-right">
											{realm ? (
												<Link
													to={`/o/${realm.org_slug ?? 'unknown'}/realms/${realm.slug}/daemons/${d.id}`}
													className="text-xs font-semibold text-indigo-600 hover:underline"
												>
													Open →
												</Link>
											) : (
												<span className="text-xs text-slate-300">—</span>
											)}
										</td>
									</tr>
								);
							})}
							{rows.length === 0 && (
								<tr>
									<td colSpan={4} className="px-4 py-8 text-center text-slate-400">No daemons.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}
			<Pagination total={total} offset={q.offset} limit={LIMIT} on_change={q.set_offset} />
		</Admin_list_page>
	);
}
