import { Link } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
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

interface WorkspaceRow {
	id: string;
	name: string | null;
	path: string;
	daemon_id: string | null;
	daemon_hostname?: string | null;
}

const LIMIT = 50;

export function Component() {
	const auth_fetch = useAuthFetch();
	const q = use_admin_list_query();
	const [rows, set_rows] = useState<WorkspaceRow[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);

	const load = useCallback(async () => {
		set_loading(true);
		try {
			const res = await auth_fetch('/v1/workspaces/get', {
				method: 'POST',
				body: JSON.stringify({ limit: LIMIT, offset: q.offset }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			let list = (data.workspaces ?? []) as WorkspaceRow[];
			const query = q.active_query.trim().toLowerCase();
			if (query) {
				list = list.filter((w) =>
					String(w.name ?? '').toLowerCase().includes(query)
					|| String(w.path ?? '').toLowerCase().includes(query)
					|| String(w.id ?? '').toLowerCase().includes(query),
				);
			}
			set_rows(list);
			set_total(query ? list.length : Number(data.total ?? list.length));
			set_error(null);
		} catch {
			set_error('Failed to load workspaces');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, q.active_query, q.offset]);

	useEffect(() => { void load(); }, [load]);

	return (
		<Admin_list_page title="All Workspaces" subtitle="Workspaces registered on any daemon.">
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />
			<Admin_search_form
				filter_draft={q.filter_draft}
				set_filter_draft={q.set_filter_draft}
				on_submit={q.apply_filter}
				placeholder="Filter by name or path…"
			/>
			{loading ? (
				<p className="text-sm text-slate-400">Loading…</p>
			) : (
				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
								<th className="px-4 py-2">Workspace</th>
								<th className="px-4 py-2">Path</th>
								<th className="px-4 py-2">Daemon</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50">
							{rows.map((w) => (
								<tr key={w.id}>
									<td className="px-4 py-2 font-medium text-slate-800">{w.name || w.id.slice(0, 8)}</td>
									<td className="px-4 py-2 font-mono text-xs text-slate-600">{w.path}</td>
									<td className="px-4 py-2 font-mono text-[10px] text-slate-400">
										{w.daemon_hostname || (w.daemon_id ? w.daemon_id.slice(0, 8) : '—')}
									</td>
								</tr>
							))}
							{rows.length === 0 && (
								<tr>
									<td colSpan={3} className="px-4 py-8 text-center text-slate-400">No workspaces.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}
			<p className="mt-2 text-xs text-slate-400">
				Open via <Link to="/admin/daemons" className="text-indigo-600 hover:underline">All Daemons</Link> → realm workspace pages.
			</p>
			<Pagination total={total} offset={q.offset} limit={LIMIT} on_change={q.set_offset} />
		</Admin_list_page>
	);
}
