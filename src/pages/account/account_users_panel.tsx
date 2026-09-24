import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';

interface OrgOption {
	id: number;
	slug: string;
	display_name: string;
	role: string;
}

interface OrgUserRow {
	id: string;
	username: string;
	display_name: string;
	email: string;
	org_role?: string;
	suspended_at?: string | null;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

export function Component() {
	const auth_fetch = useOrgFetch();
	const [search_params, set_search_params] = useSearchParams();
	const form_open = search_params.get('form') === '1';

	const [orgs, set_orgs] = useState<OrgOption[]>([]);
	const [org_id, set_org_id] = useState<number | null>(null);
	const [users, set_users] = useState<OrgUserRow[]>([]);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [filter_draft, set_filter_draft] = useState('');
	const [active_query, set_active_query] = useState('');

	const [invite_username, set_invite_username] = useState('');
	const [inviting, set_inviting] = useState(false);

	const selected_org = orgs.find((o) => o.id === org_id) ?? null;
	const can_manage = selected_org?.role === 'admin' || selected_org?.role === 'owner';

	const load_orgs = useCallback(async () => {
		try {
			const res = await auth_fetch('/v1/orgs/get', {
				method: 'POST',
				body: JSON.stringify({ mine: true }),
			});
			const data = await res.json();
			if (!data.ok) return;
			const rows = (data.data.orgs ?? []) as OrgOption[];
			set_orgs(rows);
			set_org_id((prev) => {
				if (prev != null && rows.some((o) => o.id === prev)) return prev;
				return rows[0]?.id ?? null;
			});
		} catch {
			/* users panel still shows empty state */
		}
	}, [auth_fetch]);

	const load_users = useCallback(async () => {
		if (org_id == null) {
			set_users([]);
			set_loading(false);
			return;
		}

		set_loading(true);
		try {
			const body: Record<string, unknown> = { org_id, limit: 100, offset: 0 };
			const query = active_query.trim();
			if (query) body.query = query;

			const res = await auth_fetch('/v1/users/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_users(data.data?.users ?? []);
			set_error(null);
		} catch {
			set_error('Failed to load users');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, org_id, active_query]);

	useEffect(() => {
		void load_orgs();
	}, [load_orgs]);

	useEffect(() => {
		void load_users();
	}, [load_users]);

	function open_form() {
		const next = new URLSearchParams(search_params);
		next.set('tab', 'users');
		next.set('form', '1');
		set_search_params(next, { replace: false });
		set_invite_username('');
		set_error(null);
	}

	function close_form() {
		const next = new URLSearchParams(search_params);
		next.set('tab', 'users');
		next.delete('form');
		set_search_params(next, { replace: true });
		set_invite_username('');
		set_error(null);
	}

	function apply_filter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw = new FormData(form).get('query');
		const query = typeof raw === 'string' ? raw.trim() : filter_draft.trim();
		set_filter_draft(query);
		set_active_query(query);
	}

	function clear_filter() {
		set_filter_draft('');
		set_active_query('');
	}

	async function handle_invite() {
		const username = invite_username.trim();
		if (!username) {
			set_error('Username is required');
			return;
		}
		if (org_id == null) {
			set_error('Select an organization');
			return;
		}

		set_inviting(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/orgs/add_member', {
				method: 'POST',
				body: JSON.stringify({ org_id, username }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			close_form();
			await load_users();
		} catch {
			set_error('Failed to add user');
		} finally {
			set_inviting(false);
		}
	}

	async function handle_remove(user_id: string) {
		if (org_id == null) return;
		set_error(null);
		try {
			const res = await auth_fetch('/v1/orgs/remove_member', {
				method: 'POST',
				body: JSON.stringify({ org_id, user_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await load_users();
		} catch {
			set_error('Failed to remove user');
		}
	}

	async function handle_toggle_role(user_id: string, current_role: string) {
		if (org_id == null) return;
		const role = current_role === 'admin' ? 'member' : 'admin';
		set_error(null);
		try {
			const roles_res = await auth_fetch('/v1/orgs/list_roles', {
				method: 'POST',
				body: JSON.stringify({ org_id }),
			});
			const roles_data = await roles_res.json();
			if (!roles_data.ok) {
				set_error(api_error_message(roles_data));
				return;
			}
			const role_id = (roles_data.data?.roles ?? []).find((r: { slug: string }) => r.slug === role)?.id;
			if (role_id == null) {
				set_error(`Role '${role}' not found in this org`);
				return;
			}
			const res = await auth_fetch('/v1/users/update_role', {
				method: 'POST',
				body: JSON.stringify({ org_id, user_id, role_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await load_users();
		} catch {
			set_error('Failed to change role');
		}
	}

	if (form_open) {
		return (
			<div>
				<button
					type="button"
					onClick={close_form}
					className="text-xs font-medium text-indigo-600 hover:underline"
				>
					← Back to users
				</button>
				<h2 className="mt-3 text-xl font-semibold tracking-tight">Invite user</h2>
				<p className="mt-1 max-w-2xl text-sm text-slate-500">
					Add someone to your organization. Realm access is granted per realm afterward.
				</p>

				<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

				<div className="mt-6 grid gap-8 xl:grid-cols-12">
					<div className="xl:col-span-7">
						<div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							{orgs.length > 1 && (
								<label className="block text-xs font-semibold text-slate-600">
									Organization
									<select
										value={org_id ?? ''}
										onChange={(e) => set_org_id(Number(e.target.value))}
										aria-label="Invite organization"
										className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
									>
										{orgs.map((o) => (
											<option key={o.id} value={o.id}>
												{o.display_name || o.slug}
											</option>
										))}
									</select>
								</label>
							)}
							<label className="block text-xs font-semibold text-slate-600">
								Username
								<input
									value={invite_username}
									onChange={(e) => set_invite_username(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && handle_invite()}
									placeholder="alex"
									aria-label="Invite username"
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
									autoFocus
								/>
							</label>
							<div className="flex gap-3 pt-2">
								<button
									type="button"
									onClick={() => void handle_invite()}
									disabled={inviting || !can_manage || org_id == null}
									className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
								>
									{inviting ? 'Adding…' : 'Add user'}
								</button>
								<button
									type="button"
									onClick={close_form}
									className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
								>
									Cancel
								</button>
							</div>
							{!can_manage && (
								<p className="text-xs text-amber-700">Org admin access is required to add users.</p>
							)}
						</div>
					</div>
					<aside className="xl:col-span-5">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
							<p className="font-semibold text-slate-800">Next step</p>
							<p className="mt-2">
								After they join, add them under{' '}
								<Link to="/realms" className="font-medium text-indigo-600 hover:underline">
									Realm → Users
								</Link>
								.
							</p>
						</div>
					</aside>
				</div>
			</div>
		);
	}

	return (
		<div>
			<div className="mb-4 flex items-start justify-between gap-4">
				<div>
					<h2 className="text-sm font-semibold">Users</h2>
					<p className="mt-1 text-xs text-slate-500">
						People in your org. Grant realm access from each realm → Users tab.
					</p>
				</div>
				<button
					type="button"
					onClick={open_form}
					className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Invite user
				</button>
			</div>

			{orgs.length > 1 && (
				<label className="mb-3 block text-xs font-semibold text-slate-600">
					Organization
					<select
						value={org_id ?? ''}
						onChange={(e) => set_org_id(Number(e.target.value))}
						aria-label="Filter users by organization"
						className="mt-1 w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm"
					>
						{orgs.map((o) => (
							<option key={o.id} value={o.id}>
								{o.display_name || o.slug}
							</option>
						))}
					</select>
				</label>
			)}

			<form
				onSubmit={apply_filter}
				className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
			>
				<label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-600">
					Filter
					<input
						name="query"
						value={filter_draft}
						onChange={(e) => set_filter_draft(e.target.value)}
						placeholder="username or email"
						aria-label="Filter users"
						className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
					/>
				</label>
				<button
					type="submit"
					className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
				>
					Apply
				</button>
				{active_query && (
					<button
						type="button"
						onClick={clear_filter}
						className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
					>
						Clear
					</button>
				)}
			</form>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{loading ? (
				<p className="text-sm text-slate-400">Loading users…</p>
			) : orgs.length === 0 ? (
				<div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
					<p className="text-sm text-slate-400">You are not a member of any organization.</p>
				</div>
			) : users.length === 0 ? (
				<div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
					<p className="text-sm text-slate-400">
						{active_query ? 'No users match this filter.' : 'No users in this organization.'}
					</p>
				</div>
			) : (
				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
								<th className="px-5 py-2">User</th>
								<th className="px-5 py-2">Email</th>
								<th className="px-5 py-2">Org role</th>
								<th className="px-5 py-2">Status</th>
								<th className="px-5 py-2" />
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50">
							{users.map((u) => {
								const role = u.org_role ?? 'member';
								const suspended = Boolean(u.suspended_at);
								return (
									<tr key={u.id}>
										<td className="px-5 py-3">
											<span className="font-semibold">{u.display_name || u.username}</span>{' '}
											<span className="text-slate-400">@{u.username}</span>
										</td>
										<td className="px-5 py-3 text-slate-500">{u.email}</td>
										<td className="px-5 py-3">
											<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold">
												{role}
											</span>
										</td>
										<td className="px-5 py-3">
											{suspended ? (
												<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
													suspended
												</span>
											) : (
												<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
													active
												</span>
											)}
										</td>
										<td className="px-5 py-3 text-right">
											{can_manage && (
												<div className="space-x-2">
													<button
														type="button"
														onClick={() => void handle_toggle_role(u.id, role)}
														className="text-xs font-semibold text-slate-500 hover:text-slate-800"
													>
														Change role
													</button>
													<button
														type="button"
														onClick={() => void handle_remove(u.id)}
														className="text-xs font-semibold text-red-600 hover:text-red-700"
													>
														Remove
													</button>
												</div>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
