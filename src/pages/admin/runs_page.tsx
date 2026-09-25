import { Link } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { useOrg } from '@/lib/org_context';
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

interface RunRow {
	run_id: string;
	run_name?: string | null;
	state: string;
	team_label?: string | null;
	daemon_id?: string | null;
	workspace_name?: string | null;
	started_at?: number | null;
}

const LIMIT = 50;

export function Component() {
	const auth_fetch = useAuthFetch();
	const { current_id } = useOrg();
	const q = use_admin_list_query();
	const [rows, set_rows] = useState<RunRow[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);

	const load = useCallback(async () => {
		// Body org_id is invent SoT — skip until org context is ready.
		if (!current_id) {
			set_loading(false);
			return;
		}
		set_loading(true);
		try {
			const body: Record<string, unknown> = {
				org_id: current_id,
				limit: LIMIT,
				offset: q.offset,
			};
			if (q.active_query.trim()) body.query = q.active_query.trim();
			const res = await auth_fetch('/v1/runs/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_rows(data.runs ?? []);
			set_total(Number(data.total ?? (data.runs ?? []).length));
			set_error(null);
		} catch {
			set_error('Failed to load runs');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, current_id, q.active_query, q.offset]);

	useEffect(() => { void load(); }, [load]);

	return (
		<Admin_list_page title="All Runs" subtitle="Runs across every daemon and realm.">
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />
			<Admin_search_form
				filter_draft={q.filter_draft}
				set_filter_draft={q.set_filter_draft}
				on_submit={q.apply_filter}
				placeholder="Filter by run id, name, or team…"
			/>
			{loading ? (
				<p className="text-sm text-slate-400">Loading…</p>
			) : (
				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
								<th className="px-4 py-2">Run</th>
								<th className="px-4 py-2">State</th>
								<th className="px-4 py-2">Team</th>
								<th className="px-4 py-2">Workspace</th>
								<th className="px-4 py-2">Daemon</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50">
							{rows.map((r) => (
								<tr key={r.run_id}>
									<td className="px-4 py-2">
										<p className="font-medium text-slate-800">{r.run_name || r.run_id.slice(0, 8)}</p>
										<p className="font-mono text-[10px] text-slate-400">{r.run_id}</p>
									</td>
									<td className="px-4 py-2 text-xs font-semibold text-slate-600">{r.state}</td>
									<td className="px-4 py-2 font-mono text-xs text-slate-600">{r.team_label || '—'}</td>
									<td className="px-4 py-2 text-xs text-slate-500">{r.workspace_name || '—'}</td>
									<td className="px-4 py-2 font-mono text-[10px] text-slate-400">
										{r.daemon_id ? r.daemon_id.slice(0, 8) : '—'}
									</td>
								</tr>
							))}
							{rows.length === 0 && (
								<tr>
									<td colSpan={5} className="px-4 py-8 text-center text-slate-400">No runs.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}
			<p className="mt-2 text-xs text-slate-400">
				Tip: open a realm from <Link to="/realms" className="text-indigo-600 hover:underline">Realms</Link> for run detail pages.
			</p>
			<Pagination total={total} offset={q.offset} limit={LIMIT} on_change={q.set_offset} />
		</Admin_list_page>
	);
}
