import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuthFetch } from '@/lib/auth_context';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface AuditEntry {
	id: number;
	admin_id: number;
	admin_username: string;
	action: string;
	target_type: string;
	target_id: string;
	details: string;
	created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
	'user.suspend': 'bg-amber-100 text-amber-700',
	'user.unsuspend': 'bg-emerald-100 text-emerald-700',
	'user.delete': 'bg-red-100 text-red-700',
	'user.set_role': 'bg-purple-100 text-purple-700',
	'user.reset_password': 'bg-slate-100 text-slate-600',
	'team.force_list': 'bg-emerald-100 text-emerald-700',
	'team.force_unlist': 'bg-amber-100 text-amber-700',
	'team.force_delete': 'bg-red-100 text-red-700',
	'team.transfer': 'bg-indigo-100 text-indigo-700',
	'token.revoke': 'bg-red-100 text-red-700',
	'scope.create': 'bg-emerald-100 text-emerald-700',
	'scope.update': 'bg-indigo-100 text-indigo-700',
	'scope.delete': 'bg-red-100 text-red-700',
};

export function Component() {
	const auth_fetch = useAuthFetch();
	const [entries, setEntries] = useState<AuditEntry[]>([]);
	const [total, setTotal] = useState(0);
	const [offset, setOffset] = useState(0);
	const [action_draft, set_action_draft] = useState('');
	const [type_draft, set_type_draft] = useState('');
	const [active_action, set_active_action] = useState('');
	const [active_type, set_active_type] = useState('');
	const [loading, setLoading] = useState(true);
	const [expanded, setExpanded] = useState<number | null>(null);

	const LIMIT = 30;

	const [error, set_error] = useState('');

	const load = useCallback(async () => {
		setLoading(true);
		set_error('');
		const body: Record<string, unknown> = { limit: LIMIT, offset };
		if (active_action) body.action = active_action;
		if (active_type) body.target_type = active_type;
		try {
			const res = await auth_fetch('/v1/reports/audit', { method: 'POST', body: JSON.stringify(body) });
			const data = await res.json();
			if (data.ok) {
				setEntries(data.data.entries);
				setTotal(data.data.total);
				setLoading(false);
				return;
			}
			set_error(data.error?.message || 'Failed to load audit log');
		} catch {
			set_error('Network error');
		}
		setLoading(false);
	}, [auth_fetch, offset, active_action, active_type]);

	useEffect(() => { load(); }, [load]);

	function apply_filter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw_action = new FormData(form).get('action');
		const raw_type = new FormData(form).get('target_type');
		const action = typeof raw_action === 'string' ? raw_action.trim() : action_draft.trim();
		const target_type = typeof raw_type === 'string' ? raw_type : type_draft;
		set_action_draft(action);
		set_type_draft(target_type);
		set_active_action(action);
		set_active_type(target_type);
		setOffset(0);
	}

	const total_pages = Math.ceil(total / LIMIT);
	const current_page = Math.floor(offset / LIMIT) + 1;

	function format_details(json: string): string {
		try {
			const obj = JSON.parse(json);
			return Object.entries(obj)
				.map(([k, v]) => {
					if (typeof v === 'object' && v !== null && 'from' in v && 'to' in v) {
						return `${k}: ${(v as { from: unknown }).from} → ${(v as { to: unknown }).to}`;
					}
					return `${k}: ${v}`;
				})
				.join(', ');
		} catch {
			return json;
		}
	}

	return (
		<div>
		<Breadcrumbs items={[{ label: 'Admin', to: '/admin' }, { label: 'Audit' }]} />
			<h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin · Audit Log</h1>
			<p className="mt-1 mb-4 text-sm text-slate-500">Security / admin actions · {total} entries</p>

			{error && (
				<div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
					{error}
				</div>
			)}

			<form
				onSubmit={apply_filter}
				className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
			>
				<label className="text-xs font-semibold text-slate-600">
					Target
					<select
						name="target_type"
						value={type_draft}
						onChange={(e) => set_type_draft(e.target.value)}
						className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
					>
						<option value="">All targets</option>
						<option value="user">Users</option>
						<option value="scope">Scopes</option>
						<option value="team">Teams</option>
						<option value="token">Tokens</option>
						<option value="settings">Settings</option>
					</select>
				</label>
				<label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-600">
					Action
					<input
						name="action"
						type="text"
						placeholder="e.g. user.suspend"
						value={action_draft}
						onChange={(e) => set_action_draft(e.target.value)}
						aria-label="Filter by action"
						className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
					/>
				</label>
				<button
					type="submit"
					className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
				>
					Apply
				</button>
				{(active_action || active_type) && (
					<button
						type="button"
						onClick={() => {
							set_action_draft('');
							set_type_draft('');
							set_active_action('');
							set_active_type('');
							setOffset(0);
						}}
						className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
					>
						Clear
					</button>
				)}
			</form>

			<div className="space-y-2">
				{loading && <p className="text-sm text-slate-400">Loading...</p>}
				{!loading && entries.length === 0 && <p className="text-sm text-slate-400">No audit entries found</p>}
				{!loading && entries.map((e) => (
					<div
						key={e.id}
						onClick={() => setExpanded(expanded === e.id ? null : e.id)}
						className="cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-slate-300"
					>
						<div className="flex items-center gap-3">
							<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[e.action] || 'bg-slate-100 text-slate-600'}`}>
								{e.action}
							</span>
							<span className="text-sm text-slate-700">
								{e.target_type} <span className="font-mono text-xs text-slate-400">#{e.target_id}</span>
							</span>
							<span className="ml-auto text-xs text-slate-400">
								by @{e.admin_username} · {new Date(e.created_at).toLocaleString()}
							</span>
						</div>
						{expanded === e.id && e.details !== '{}' && (
							<p className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
								{format_details(e.details)}
							</p>
						)}
					</div>
				))}
			</div>

			{total_pages > 1 && (
				<div className="mt-4 flex items-center justify-between text-sm">
					<button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">← Prev</button>
					<span className="text-xs text-slate-400">Page {current_page} of {total_pages}</span>
					<button onClick={() => setOffset(offset + LIMIT)} disabled={current_page >= total_pages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next →</button>
				</div>
			)}
		</div>
	);
}
