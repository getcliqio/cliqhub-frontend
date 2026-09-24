import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { validate_slug, validate_email, validate_password, validate_display_name } from '@/lib/validation';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface AdminUser {
	id: string;
	username: string;
	display_name: string;
	email: string;
	role: string;
	suspended_at: string | null;
	created_at: string;
}

interface UserOrg {
	id: string;
	slug: string;
	display_name: string;
	role: string;
}

interface UserDetail extends AdminUser {
	suspended_reason: string;
	scope_count: number;
	team_count: number;
	token_count: number;
	draft_count: number;
	orgs: UserOrg[];
}

export function Component() {
	const auth_fetch = useAuthFetch();
	const { user: admin_user, act_as } = useAuth();
	const navigate = useNavigate();
	const [users, setUsers] = useState<AdminUser[]>([]);
	const [total, setTotal] = useState(0);
	const [offset, setOffset] = useState(0);
	const [filter_draft, set_filter_draft] = useState('');
	const [active_query, set_active_query] = useState('');
	const [loading, setLoading] = useState(true);

	const [detail, setDetail] = useState<UserDetail | null>(null);
	const [detail_loading, setDetailLoading] = useState(false);

	const [confirm, setConfirm] = useState<{ action: string; user_id: string; label: string; entity_name: string } | null>(null);
	const [confirm_text, setConfirmText] = useState('');
	const [password_modal, setPasswordModal] = useState<{ user_id: string; username: string } | null>(null);
	const [new_password, setNewPassword] = useState('');
	const [action_error, setActionError] = useState('');
	const [takeover_busy, set_takeover_busy] = useState(false);

	const [editing, setEditing] = useState(false);
	const [edit_email, setEditEmail] = useState('');
	const [edit_display, setEditDisplay] = useState('');

	const [creating, setCreating] = useState(false);
	const [new_username, setNewUsername] = useState('');
	const [new_email, setNewEmail] = useState('');
	const [new_display_name, setNewDisplayName] = useState('');
	const [new_user_password, setNewUserPassword] = useState('');
	const [field_errors, setFieldErrors] = useState<Record<string, string | null>>({});
	const [touched, setTouched] = useState<Record<string, boolean>>({});

	const LIMIT = 20;

	const load_users = useCallback(async () => {
		setLoading(true);
		try {
			const body: Record<string, unknown> = { limit: LIMIT, offset };
			const query = active_query.trim();
			if (query) body.query = query;
			const res = await auth_fetch('/v1/users/get', { method: 'POST', body: JSON.stringify(body) });
			const data = await res.json();
			if (data.ok) {
				setUsers(data.data.users);
				setTotal(data.data.total);
			}
			if (!data.ok) {
				setActionError(data.error?.message || 'Failed to load users');
			}
		} catch {
			setActionError('Failed to load users');
		}
		setLoading(false);
	}, [auth_fetch, offset, active_query]);

	useEffect(() => { load_users(); }, [load_users]);

	function apply_filter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw = new FormData(form).get('query');
		const query = typeof raw === 'string' ? raw.trim() : filter_draft.trim();
		set_filter_draft(query);
		set_active_query(query);
		setOffset(0);
	}

	async function open_detail(user_id: string) {
		setCreating(false);
		setDetailLoading(true);
		setDetail(null);
		setActionError('');
		try {
			const res = await auth_fetch('/v1/users/get_by_id', { method: 'POST', body: JSON.stringify({ user_id }) });
			const data = await res.json();
			if (data.ok) {
				setDetail(data.data);
				setDetailLoading(false);
				return;
			}
			setActionError(data.error?.message || 'Failed to load user details');
		} catch {
			setActionError('Failed to load user details');
		}
		setDetailLoading(false);
	}

	function validate_field(field: string, value: string): string | null {
		if (field === 'username') return validate_slug(value);
		if (field === 'email') return validate_email(value);
		if (field === 'password') return validate_password(value);
		return null;
	}

	function handle_field_change(field: string, value: string) {
		if (field === 'username') setNewUsername(value);
		if (field === 'email') setNewEmail(value);
		if (field === 'password') setNewUserPassword(value);
		if (field === 'display_name') setNewDisplayName(value);

		if (touched[field]) {
			setFieldErrors((prev) => ({ ...prev, [field]: validate_field(field, value) }));
		}
	}

	function handle_field_blur(field: string, value: string) {
		setTouched((prev) => ({ ...prev, [field]: true }));
		setFieldErrors((prev) => ({ ...prev, [field]: validate_field(field, value) }));
	}

	async function handle_create_user() {
		setActionError('');
		const all_touched = { username: true, email: true, password: true };
		setTouched((prev) => ({ ...prev, ...all_touched }));

		const errors: Record<string, string | null> = {
			username: validate_slug(new_username),
			email: validate_email(new_email),
			password: validate_password(new_user_password),
		};
		setFieldErrors((prev) => ({ ...prev, ...errors }));

		const first_error = errors.username || errors.email || errors.password;
		if (first_error) return;

		try {
			const res = await auth_fetch('/v1/users/new', {
				method: 'POST',
				body: JSON.stringify({
					username: new_username,
					email: new_email,
					display_name: new_display_name || undefined,
					password: new_user_password,
				}),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			setCreating(false);
			setNewUsername('');
			setNewEmail('');
			setNewDisplayName('');
			setNewUserPassword('');
			setFieldErrors({});
			setTouched({});
			load_users();
		} catch {
			setActionError('Network error');
		}
	}

	async function handle_take_over(user_id?: string) {
		const target_id = user_id ?? detail?.id;
		if (!target_id) return;
		if (admin_user && target_id === admin_user.id) {
			setActionError('Cannot take over your own account');
			return;
		}
		setActionError('');
		set_takeover_busy(true);
		const err = await act_as(target_id);
		set_takeover_busy(false);
		if (err) {
			setActionError(err);
			return;
		}
		navigate('/home', { replace: true });
	}

	function start_editing() {
		if (!detail) return;
		setEditEmail(detail.email);
		setEditDisplay(detail.display_name);
		setEditing(true);
		setActionError('');
	}

	async function save_edits() {
		if (!detail) return;
		setActionError('');
		if (edit_display !== detail.display_name) {
			const name_err = validate_display_name(edit_display);
			if (name_err) { setActionError(name_err); return; }
		}
		if (edit_email !== detail.email) {
			const email_err = validate_email(edit_email);
			if (email_err) { setActionError(email_err); return; }
		}
		const body: Record<string, unknown> = { user_id: detail.id };
		if (edit_email !== detail.email) body.email = edit_email;
		if (edit_display !== detail.display_name) body.display_name = edit_display;
		if (!body.email && !body.display_name) { setEditing(false); return; }
		try {
			const res = await auth_fetch('/v1/users/update', { method: 'POST', body: JSON.stringify(body) });
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			setEditing(false);
			open_detail(detail.id);
			load_users();
		} catch {
			setActionError('Network error');
		}
	}

	async function do_action(action: string, user_id: string, body?: Record<string, unknown>) {
		setActionError('');
		const endpoint_map: Record<string, string> = {
			'suspend': '/v1/users/suspend',
			'unsuspend': '/v1/users/unsuspend',
			'delete': '/v1/users/delete',
			'set-role': '/v1/users/set_role',
			'reset-password': '/v1/users/reset_password',
		};
		let resolved_action = action;
		const merged_body: Record<string, unknown> = { user_id, ...body };
		if (action.startsWith('set-role:')) {
			resolved_action = 'set-role';
			merged_body.role = action.split(':')[1];
		}
		const endpoint = endpoint_map[resolved_action];
		if (!endpoint) return;
		try {
			const res = await auth_fetch(endpoint, { method: 'POST', body: JSON.stringify(merged_body) });
			const data = await res.json();
			if (!data.ok) {
				setActionError(data.error?.message || 'Action failed');
				return;
			}
			setConfirm(null);
			setConfirmText('');
			setPasswordModal(null);
			setNewPassword('');
			setEditing(false);
			setDetail(null);
			setDetailLoading(false);
			setActionError('');
			load_users();
		} catch {
			setActionError('Network error');
		}
	}

	const total_pages = Math.ceil(total / LIMIT);
	const current_page = Math.floor(offset / LIMIT) + 1;

	return (
		<div>
		<Breadcrumbs items={[{ label: 'Admin', to: '/admin' }, { label: 'Accounts' }]} />
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin · Users</h1>
					<p className="mt-1 mb-4 text-sm text-slate-500">
						{total} total · use <span className="font-medium text-amber-800">Take over</span> to operate in a member&apos;s Hub UI
					</p>
				</div>
				<button
					onClick={() => { setCreating(true); setDetail(null); setActionError(''); setFieldErrors({}); setTouched({}); }}
					className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Invite user
				</button>
			</div>

			<form
				onSubmit={apply_filter}
				className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
			>
				<label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-600">
					Filter
					<input
						name="query"
						type="text"
						placeholder="username or email"
						value={filter_draft}
						onChange={(e) => set_filter_draft(e.target.value)}
						aria-label="Filter accounts"
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
						onClick={() => { set_filter_draft(''); set_active_query(''); setOffset(0); }}
						className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
					>
						Clear
					</button>
				)}
			</form>

			{creating && (
				<div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
					<p className="mb-3 text-sm font-semibold text-slate-800">New account</p>
					<p className="mb-3 text-xs text-slate-700">Creates an account and their personal scope.</p>
				<div className="grid grid-cols-2 gap-3">
					<div>
						<input
							placeholder="username" value={new_username}
							onChange={(e) => handle_field_change('username', e.target.value.toLowerCase())}
							onBlur={() => handle_field_blur('username', new_username)}
							className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${touched.username && field_errors.username ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-indigo-500'}`}
						/>
						{touched.username && field_errors.username && (
							<p className="mt-1 text-xs text-red-500">{field_errors.username}</p>
						)}
					</div>
					<div>
						<input
							placeholder="email" value={new_email}
							onChange={(e) => handle_field_change('email', e.target.value)}
							onBlur={() => handle_field_blur('email', new_email)}
							className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${touched.email && field_errors.email ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-indigo-500'}`}
						/>
						{touched.email && field_errors.email && (
							<p className="mt-1 text-xs text-red-500">{field_errors.email}</p>
						)}
					</div>
					<div>
						<input
							placeholder="display name (optional)" value={new_display_name}
							onChange={(e) => handle_field_change('display_name', e.target.value)}
							className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
						/>
					</div>
					<div>
						<input
							type="password"
							placeholder="password" value={new_user_password}
							onChange={(e) => handle_field_change('password', e.target.value)}
							onBlur={() => handle_field_blur('password', new_user_password)}
							className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${touched.password && field_errors.password ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-indigo-500'}`}
						/>
						{touched.password && field_errors.password && (
							<p className="mt-1 text-xs text-red-500">{field_errors.password}</p>
						)}
						<p className="mt-1 text-[10px] text-slate-400">Min 8 chars, uppercase, lowercase, number, special character</p>
					</div>
				</div>
				{action_error && <p className="mt-2 text-xs text-red-500">{action_error}</p>}
				<div className="mt-3 flex gap-2">
					<button
						onClick={handle_create_user}
						className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
					>
						Create
					</button>
						<button
							onClick={() => { setCreating(false); setActionError(''); setFieldErrors({}); setTouched({}); }}
							className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Detail / action panel */}
			{(detail || detail_loading) && (
				<div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
					{detail_loading && <p className="text-sm text-slate-600">Loading...</p>}
					{detail && (
						<div>
							<div className="flex items-start justify-between">
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<p className="text-sm font-bold text-slate-900">@{detail.username}</p>
										<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${detail.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
											{detail.role}
										</span>
										{detail.suspended_at && (
											<span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
												suspended
											</span>
										)}
									</div>
									{detail.suspended_at && detail.suspended_reason && (
										<p className="mt-1 text-xs text-red-500">Reason: {detail.suspended_reason}</p>
									)}

									{editing ? (
										<div className="mt-3 space-y-2">
											<div>
												<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display Name</label>
												<input
													value={edit_display}
													onChange={(e) => setEditDisplay(e.target.value)}
													className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
												/>
											</div>
											<div>
												<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Email</label>
												<input
													value={edit_email}
													onChange={(e) => setEditEmail(e.target.value)}
													className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
												/>
											</div>
											<div className="flex gap-2 pt-1">
												<button onClick={save_edits} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Save</button>
												<button onClick={() => setEditing(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
											</div>
										</div>
									) : (
										<div className="mt-1 flex items-center gap-2">
											<p className="text-xs text-slate-700">{detail.email} · {detail.display_name}</p>
											<button onClick={start_editing} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 hover:text-slate-800">Edit</button>
										</div>
									)}
								</div>
								<button onClick={() => { setDetail(null); setEditing(false); }} className="text-xs text-slate-500 hover:text-slate-700">✕</button>
							</div>

							<div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-700">
								<span>{detail.scope_count} scope(s)</span>
								<span>{detail.team_count} team(s)</span>
								<span>{detail.token_count} token(s)</span>
								<span>{detail.draft_count} draft(s)</span>
								<span>Joined {new Date(detail.created_at).toLocaleDateString()}</span>
							</div>

							{detail.orgs.length > 0 && (
								<div className="mt-3">
									<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Organizations</p>
									<div className="flex flex-wrap gap-2">
										{detail.orgs.map((org) => (
											<a
												key={org.id}
												href={`/admin/orgs/${org.id}`}
												className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs hover:border-indigo-300 hover:bg-indigo-50"
											>
												<span className="font-semibold text-slate-700">{org.display_name}</span>
												<span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
													org.role === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'
												}`}>
													{org.role}
												</span>
											</a>
										))}
									</div>
								</div>
							)}

							{action_error && <p className="mt-2 text-xs text-red-500">{action_error}</p>}

							<div className="mt-4 flex flex-wrap gap-2">
								{admin_user && detail.id !== admin_user.id && !detail.suspended_at && (
									<button
										type="button"
										disabled={takeover_busy}
										onClick={() => { void handle_take_over(); }}
										className="rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-60"
									>
										{takeover_busy ? 'Taking over…' : 'Take over account'}
									</button>
								)}

								{!detail.suspended_at ? (
									<button
										onClick={() => { setConfirm({ action: 'suspend', user_id: detail.id, label: `Suspend @${detail.username}?`, entity_name: `@${detail.username}` }); setConfirmText(''); }}
										className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
									>
										Suspend
									</button>
								) : (
									<button
										onClick={() => do_action('unsuspend', detail.id)}
										className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
									>
										Unsuspend
									</button>
								)}

								<button
									onClick={() => setPasswordModal({ user_id: detail.id, username: detail.username })}
									className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
								>
									Reset Password
								</button>

								<button
									onClick={() => {
										const new_role = detail.role === 'admin' ? 'user' : 'admin';
										const label = detail.role === 'admin'
											? `Demote @${detail.username} to user?`
											: `Promote @${detail.username} to admin?`;
										setConfirm({ action: `set-role:${new_role}`, user_id: detail.id, label, entity_name: `@${detail.username}` });
										setConfirmText('');
									}}
									className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
								>
									{detail.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
								</button>

								<button
									onClick={() => { setConfirm({ action: 'delete', user_id: detail.id, label: `Delete @${detail.username}? This cannot be undone.`, entity_name: `@${detail.username}` }); setConfirmText(''); }}
									className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
								>
									Delete
								</button>
							</div>
						</div>
					)}
				</div>
			)}

			{/* Confirm modal */}
			{confirm && (
				<div className={`mb-4 rounded-lg border p-4 ${confirm.action === 'delete' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
					<p className={`text-sm font-medium ${confirm.action === 'delete' ? 'text-red-800' : 'text-amber-800'}`}>{confirm.label}</p>
					<div className="mt-2">
						<label className="mb-1 block text-xs text-slate-600">
							Type <span className="font-mono font-semibold">{confirm.entity_name}</span> to confirm
						</label>
						<input
							type="text"
							value={confirm_text}
							onChange={(e) => setConfirmText(e.target.value)}
							placeholder={confirm.entity_name}
							className={`w-full max-w-sm rounded-lg border px-3 py-2 font-mono text-sm outline-none ${confirm.action === 'delete' ? 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500' : 'border-amber-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'}`}
						/>
					</div>
					<div className="mt-3 flex gap-2">
						<button
							onClick={() => do_action(confirm.action, confirm.user_id)}
							disabled={confirm_text !== confirm.entity_name}
							className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${confirm.action === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
						>
							Confirm
						</button>
						<button onClick={() => { setConfirm(null); setConfirmText(''); setActionError(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Password reset modal */}
			{password_modal && (() => {
				const reset_pw_err = new_password ? validate_password(new_password) : null;
				return (
					<div className="mb-4 rounded-lg border border-slate-300 bg-white p-4">
						<p className="text-sm font-medium text-slate-800">Reset password for @{password_modal.username}</p>
						<input
							type="password"
							placeholder="New password"
							value={new_password}
							onChange={(e) => setNewPassword(e.target.value)}
							className={`mt-2 w-full max-w-sm rounded-lg border px-3 py-2 text-sm focus:outline-none ${new_password && reset_pw_err ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-indigo-500'}`}
						/>
						{new_password && reset_pw_err && (
							<p className="mt-1 text-xs text-red-500">{reset_pw_err}</p>
						)}
						<p className="mt-1 text-[10px] text-slate-400">Min 8 chars, uppercase, lowercase, number, special character</p>
						{action_error && <p className="mt-1 text-xs text-red-500">{action_error}</p>}
						<div className="mt-3 flex gap-2">
							<button
								onClick={() => {
									const err = validate_password(new_password);
									if (err) { setActionError(err); return; }
									do_action('reset-password', password_modal.user_id, { new_password });
								}}
								disabled={!!reset_pw_err}
								className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
							>
								Reset
							</button>
							<button onClick={() => { setPasswordModal(null); setNewPassword(''); setActionError(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
								Cancel
							</button>
						</div>
					</div>
				);
			})()}

			{/* Table */}
			<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
				<table className="w-full text-left text-sm">
					<thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
						<tr>
							<th className="px-4 py-3">User</th>
							<th className="px-4 py-3">Email</th>
							<th className="px-4 py-3">Role</th>
							<th className="px-4 py-3">Status</th>
							<th className="px-4 py-3">Joined</th>
							<th className="px-4 py-3 text-right">Actions</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{loading && (
							<tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading...</td></tr>
						)}
						{!loading && users.length === 0 && (
							<tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No accounts found</td></tr>
						)}
						{!loading && users.map((u) => (
							<tr key={u.id} onClick={() => open_detail(u.id)} className="cursor-pointer hover:bg-slate-50">
								<td className="px-4 py-3 font-medium text-slate-900">@{u.username}</td>
								<td className="px-4 py-3 text-slate-700">{u.email}</td>
								<td className="px-4 py-3">
									<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
										{u.role}
									</span>
								</td>
								<td className="px-4 py-3">
									{u.suspended_at ? (
										<span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">suspended</span>
									) : (
										<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">active</span>
									)}
								</td>
								<td className="px-4 py-3 text-slate-600">{new Date(u.created_at).toLocaleDateString()}</td>
								<td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
									{admin_user && u.id !== admin_user.id && !u.suspended_at ? (
										<button
											type="button"
											disabled={takeover_busy}
											onClick={() => { void handle_take_over(u.id); }}
											className="rounded-lg border border-amber-400 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-60"
										>
											{takeover_busy ? '…' : 'Take over'}
										</button>
									) : (
										<span className="text-[11px] text-slate-400">—</span>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* Pagination */}
			{total_pages > 1 && (
				<div className="mt-4 flex items-center justify-between text-sm">
					<button
						onClick={() => setOffset(Math.max(0, offset - LIMIT))}
						disabled={offset === 0}
						className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
					>
						← Prev
					</button>
					<span className="text-xs text-slate-600">Page {current_page} of {total_pages}</span>
					<button
						onClick={() => setOffset(offset + LIMIT)}
						disabled={current_page >= total_pages}
						className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
					>
						Next →
					</button>
				</div>
			)}
		</div>
	);
}
