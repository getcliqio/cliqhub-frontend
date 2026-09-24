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

interface Log_line {
	id: string;
	run_id: string;
	run_name: string | null;
	created_at: number;
	level: string;
	message: string;
	daemon_id: string | null;
	daemon_name: string | null;
	team: string | null;
	realm_id: string | null;
}

const LIMIT = 50;

function level_class(level: string): string {
	if (level === 'error') return 'text-red-600';
	if (level === 'warn') return 'text-amber-600';
	return 'text-slate-700';
}

export function Component() {
	const auth_fetch = useAuthFetch();
	const q = use_admin_list_query();
	const [rows, set_rows] = useState<Log_line[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);

	const load = useCallback(async () => {
		set_loading(true);
		try {
			const body: Record<string, unknown> = {
				limit: LIMIT,
				offset: q.offset,
			};
			if (q.active_query.trim()) body.q = q.active_query.trim();
			const res = await auth_fetch('/v1/runs/get_logs', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_rows(data.lines ?? []);
			set_total(Number(data.total ?? (data.lines ?? []).length));
			set_error(null);
		} catch {
			set_error('Failed to load logs');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, q.active_query, q.offset]);

	useEffect(() => { void load(); }, [load]);

	return (
		<Admin_list_page title="All Logs" subtitle="Log lines across every realm (site admin).">
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />
			<Admin_search_form
				filter_draft={q.filter_draft}
				set_filter_draft={q.set_filter_draft}
				on_submit={q.apply_filter}
				placeholder="Search log message…"
			/>
			{loading ? (
				<p className="text-sm text-slate-400">Loading…</p>
			) : (
				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
					<ul className="divide-y divide-slate-50 font-mono text-xs">
						{rows.map((line) => (
							<li key={line.id} className="px-4 py-2">
								<div className="mb-0.5 flex flex-wrap gap-2 text-[10px] text-slate-400">
									<span>{new Date(line.created_at).toLocaleString()}</span>
									<span className={level_class(line.level)}>{line.level}</span>
									<span>{line.run_name || line.run_id.slice(0, 8)}</span>
									{line.daemon_name && <span>{line.daemon_name}</span>}
									{line.team && <span>{line.team}</span>}
								</div>
								<pre className="whitespace-pre-wrap break-all text-slate-800">{line.message}</pre>
							</li>
						))}
						{rows.length === 0 && (
							<li className="px-4 py-8 text-center text-slate-400">No log lines.</li>
						)}
					</ul>
				</div>
			)}
			<Pagination total={total} offset={q.offset} limit={LIMIT} on_change={q.set_offset} />
		</Admin_list_page>
	);
}
