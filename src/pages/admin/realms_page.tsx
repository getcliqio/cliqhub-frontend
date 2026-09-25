import { Link } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { useOrg } from '@/lib/org_context';
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

interface RealmRow {
	id: string;
	slug: string;
	org_slug: string | null;
	name: string;
	owner_user_id?: string | null;
	created_at: number | string;
}

const LIMIT = 50;

export function Component() {
	const auth_fetch = useAuthFetch();
	const { current_id } = useOrg();
	const q = use_admin_list_query();
	const [rows, set_rows] = useState<RealmRow[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);

	const load = useCallback(async () => {
		set_loading(true);
		try {
			const body: Record<string, unknown> = {
				limit: LIMIT,
				offset: q.offset,
				sort_by: 'slug',
				sort_dir: 'asc',
			};
			if (q.active_query.trim()) body.query = q.active_query.trim();
			if (current_id) body.org_id = current_id;
			const res = await auth_fetch('/v1/realms/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_rows(data.realms ?? []);
			set_total(typeof data.total === 'number' ? data.total : (data.realms ?? []).length);
			set_error(null);
		} catch {
			set_error('Failed to load realms');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, current_id, q.active_query, q.offset]);

	useEffect(() => { void load(); }, [load]);

	return (
		<Admin_list_page title="Realms" subtitle="Realms you belong to (membership-scoped). Use Users → Take over to inspect another account.">
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />
			<Admin_search_form
				filter_draft={q.filter_draft}
				set_filter_draft={q.set_filter_draft}
				on_submit={q.apply_filter}
				placeholder="Filter by slug or name…"
			/>
			{loading ? (
				<p className="text-sm text-slate-400">Loading…</p>
			) : (
				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
								<th className="px-4 py-2">Name</th>
								<th className="px-4 py-2">Slug</th>
								<th className="px-4 py-2">Owner</th>
								<th className="px-4 py-2 text-right">Open</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50">
							{rows.map((r) => (
								<tr key={r.id}>
									<td className="px-4 py-2 font-medium text-slate-800">{r.name}</td>
									<td className="px-4 py-2 font-mono text-xs text-slate-600">{realm_qualified_label(r.org_slug, r.slug)}</td>
									<td className="px-4 py-2 font-mono text-xs text-slate-400">{r.owner_user_id || '—'}</td>
									<td className="px-4 py-2 text-right">
										<Link to={`/o/${r.org_slug ?? 'unknown'}/realms/${r.slug}`} className="text-xs font-semibold text-indigo-600 hover:underline">
											Open →
										</Link>
									</td>
								</tr>
							))}
							{rows.length === 0 && (
								<tr>
									<td colSpan={4} className="px-4 py-8 text-center text-slate-400">No realms.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}
			<p className="mt-2 text-xs text-slate-400">{total} realm(s)</p>
			<Pagination total={total} offset={q.offset} limit={LIMIT} on_change={q.set_offset} />
		</Admin_list_page>
	);
}
