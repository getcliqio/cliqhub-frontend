import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { validate_slug, validate_email, validate_password, validate_display_name } from '@/lib/validation';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface AdminOrg {
	id: number;
	slug: string;
	display_name: string;
	member_count: number;
	scope_count: number;
	created_at: string;
}

type UserLookupStatus = 'idle' | 'checking' | 'found' | 'not_found' | 'error';

export function Component() {
	const auth_fetch = useAuthFetch();
	const navigate = useNavigate();
	const [orgs, set_orgs] = useState<AdminOrg[]>([]);
	const [total, set_total] = useState(0);
	const [offset, set_offset] = useState(0);
	const [filter_draft, set_filter_draft] = useState('');
	const [active_query, set_active_query] = useState('');
	const [loading, set_loading] = useState(true);

	const [creating, set_creating] = useState(false);
	const [new_slug, set_new_slug] = useState('');
	const [new_display, set_new_display] = useState('');
	const [new_admin_username, set_new_admin_username] = useState('');
	const [new_admin_email, set_new_admin_email] = useState('');
	const [new_admin_password, set_new_admin_password] = useState('');
	const [new_admin_display, set_new_admin_display] = useState('');

	const [user_lookup_status, set_user_lookup_status] = useState<UserLookupStatus>('idle');
	const [found_user_display, set_found_user_display] = useState('');
	const lookup_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [field_errors, set_field_errors] = useState<Record<string, string | null>>({});
	const [touched, set_touched] = useState<Record<string, boolean>>({});
	const [action_error, set_action_error] = useState('');

	const LIMIT = 20;

	const load = useCallback(async () => {
		set_loading(true);
		try {
			const body: Record<string, unknown> = { limit: LIMIT, offset, exclude_personal: true };
			const query = active_query.trim();
			if (query) body.query = query;
			const res = await auth_fetch('/v1/orgs/get', { method: 'POST', body: JSON.stringify(body) });
			const data = await res.json();
			if (data.ok) { set_orgs(data.data.orgs); set_total(data.data.total); }
			if (!data.ok) { set_action_error(data.error?.message || 'Failed to load orgs'); }
		} catch {
			set_action_error('Network error');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, offset, active_query]);

	useEffect(() => { load(); }, [load]);

	function apply_filter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw = new FormData(form).get('query');
		const query = typeof raw === 'string' ? raw.trim() : filter_draft.trim();
		set_filter_draft(query);
		set_active_query(query);
		set_offset(0);
	}

	function reset_create_form() {
		set_creating(false);
		set_new_slug('');
		set_new_display('');
		set_new_admin_username('');
		set_new_admin_email('');
		set_new_admin_password('');
		set_new_admin_display('');
		set_user_lookup_status('idle');
		set_found_user_display('');
		set_field_errors({});
		set_touched({});
	}

	// ── Server-side username lookup (debounced) ──

	function lookup_user(username: string) {
		if (lookup_timer.current) clearTimeout(lookup_timer.current);

		if (!username || username.length < 2) {
			set_user_lookup_status('idle');
			set_found_user_display('');
			return;
		}

		set_user_lookup_status('checking');
		lookup_timer.current = setTimeout(async () => {
			try {
				const res = await auth_fetch('/v1/users/get', {
					method: 'POST',
					body: JSON.stringify({ query: username, limit: 1, offset: 0 }),
				});
				const data = await res.json();
				if (!data.ok) {
					set_user_lookup_status('error');
					return;
				}
				const users = data.data.users as { username: string; email: string; display_name: string }[];
				const exact_match = users.length > 0 && users[0].username === username ? users[0] : null;
				if (exact_match) {
					set_user_lookup_status('found');
					set_found_user_display(`${exact_match.display_name} (${exact_match.email})`);
					return;
				}
				set_user_lookup_status('not_found');
				set_found_user_display('');
			} catch {
				set_user_lookup_status('error');
			}
		}, 400);
	}

	function handle_admin_username_change(value: string) {
		const lower = value.toLowerCase();
		set_new_admin_username(lower);
		set_new_admin_email('');
		set_new_admin_password('');
		set_new_admin_display('');
		lookup_user(lower);
		if (touched.admin_username) {
			set_field_errors((prev) => ({ ...prev, admin_username: validate_slug(lower) }));
		}
	}

	// ── Field validation ──

	function validate_field(field: string, value: string): string | null {
		if (field === 'org_slug') return validate_slug(value);
		if (field === 'org_display') return validate_display_name(value);
		if (field === 'admin_username') return validate_slug(value);
		if (field === 'admin_email') return validate_email(value);
		if (field === 'admin_password') return validate_password(value);
		return null;
	}

	function handle_field_change(field: string, value: string, setter: (v: string) => void) {
		setter(value);
		if (touched[field]) {
			set_field_errors((prev) => ({ ...prev, [field]: validate_field(field, value) }));
		}
	}

	function handle_field_blur(field: string, value: string) {
		set_touched((prev) => ({ ...prev, [field]: true }));
		set_field_errors((prev) => ({ ...prev, [field]: validate_field(field, value) }));
	}

	function input_class(field: string): string {
		const has_error = touched[field] && field_errors[field];
		return `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${has_error ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-indigo-500'}`;
	}

	// ── Submit ──

	async function handle_create() {
		set_action_error('');
		const needs_new_user = user_lookup_status === 'not_found';

		const all_touched: Record<string, boolean> = { org_slug: true, admin_username: true };
		if (new_display) all_touched.org_display = true;
		if (needs_new_user) {
			all_touched.admin_email = true;
			all_touched.admin_password = true;
		}
		set_touched((prev) => ({ ...prev, ...all_touched }));

		const errors: Record<string, string | null> = {
			org_slug: validate_slug(new_slug),
			admin_username: validate_slug(new_admin_username),
		};
		if (needs_new_user) {
			errors.admin_email = validate_email(new_admin_email);
			errors.admin_password = validate_password(new_admin_password);
		}
		set_field_errors((prev) => ({ ...prev, ...errors }));

		if (Object.values(errors).some((e) => e !== null)) return;

		if (user_lookup_status === 'checking') {
			set_action_error('Still checking if user exists — please wait');
			return;
		}
		if (user_lookup_status === 'idle') {
			set_action_error('Enter an admin username first');
			return;
		}

		const body: Record<string, unknown> = {
			slug: new_slug,
			display_name: new_display || undefined,
			admin_username: new_admin_username,
		};
		if (needs_new_user) {
			body.admin_email = new_admin_email;
			body.admin_password = new_admin_password;
			body.admin_display_name = new_admin_display || undefined;
		}
		try {
			const res = await auth_fetch('/v1/orgs/new', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) { set_action_error(data.error?.message || 'Failed'); return; }
			reset_create_form();
			load();
		} catch {
			set_action_error('Network error');
		}
	}

	const total_pages = Math.ceil(total / LIMIT);
	const current_page = Math.floor(offset / LIMIT) + 1;

	return (
		<div>
		<Breadcrumbs items={[{ label: 'Admin', to: '/admin' }, { label: 'Orgs' }]} />
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin · Organizations</h1>
					<p className="mt-1 mb-4 text-sm text-slate-500">{total} organization{total === 1 ? '' : 's'}</p>
				</div>
				<button
					onClick={() => { set_creating(true); set_action_error(''); set_field_errors({}); set_touched({}); }}
					className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Create org
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
						placeholder="org slug or name"
						value={filter_draft}
						onChange={(e) => set_filter_draft(e.target.value)}
						aria-label="Filter organizations"
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
						onClick={() => { set_filter_draft(''); set_active_query(''); set_offset(0); }}
						className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
					>
						Clear
					</button>
				)}
			</form>

			{action_error && !creating && <p className="mb-3 text-xs text-red-500">{action_error}</p>}

			{creating && (
				<div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
					<p className="mb-1 text-sm font-semibold text-slate-800">New Organization</p>
					<p className="mb-4 text-xs text-slate-500">
						Creates the org, a default @slug scope, and assigns the initial admin.
					</p>

					{/* ── Org fields ── */}
					<div className="mb-4 grid grid-cols-2 gap-3">
						<div>
							<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Org Slug</label>
							<input
								placeholder="e.g. acme" value={new_slug}
								onChange={(e) => handle_field_change('org_slug', e.target.value.toLowerCase(), set_new_slug)}
								onBlur={() => handle_field_blur('org_slug', new_slug)}
								className={input_class('org_slug')}
							/>
							{touched.org_slug && field_errors.org_slug && (
								<p className="mt-1 text-xs text-red-500">{field_errors.org_slug}</p>
							)}
						</div>
						<div>
							<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display Name</label>
							<input
								placeholder="Acme Inc." value={new_display}
								onChange={(e) => set_new_display(e.target.value)}
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
							/>
						</div>
					</div>

					{/* ── Admin user section ── */}
					<div className="rounded-lg border border-slate-200 bg-white/60 p-3">
						<p className="mb-2 text-xs font-semibold text-slate-700">Org Admin</p>
						<div>
							<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Username</label>
							<input
								placeholder="e.g. sapan1" value={new_admin_username}
								onChange={(e) => handle_admin_username_change(e.target.value)}
								onBlur={() => handle_field_blur('admin_username', new_admin_username)}
								className={input_class('admin_username')}
							/>
							{touched.admin_username && field_errors.admin_username && (
								<p className="mt-1 text-xs text-red-500">{field_errors.admin_username}</p>
							)}

							{/* Lookup status indicator */}
							{user_lookup_status === 'checking' && (
								<p className="mt-1 text-xs text-slate-400">Checking...</p>
							)}
							{user_lookup_status === 'found' && (
								<p className="mt-1 text-xs text-emerald-600">
									User found: <span className="font-semibold">@{new_admin_username}</span> &mdash; {found_user_display}
								</p>
							)}
							{user_lookup_status === 'not_found' && !field_errors.admin_username && (
								<p className="mt-1 text-xs text-amber-600">
									No user with username &ldquo;{new_admin_username}&rdquo; found &mdash; a new account will be created.
								</p>
							)}
							{user_lookup_status === 'error' && (
								<p className="mt-1 text-xs text-red-500">Could not verify username. Try again.</p>
							)}
						</div>

						{/* New user creation fields — shown only when user doesn't exist */}
						{user_lookup_status === 'not_found' && !field_errors.admin_username && (
							<div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
								<p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">New Account Details</p>
								<div className="grid grid-cols-2 gap-3">
									<div>
										<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Email</label>
										<input
											placeholder="user@example.com" value={new_admin_email}
											onChange={(e) => handle_field_change('admin_email', e.target.value, set_new_admin_email)}
											onBlur={() => handle_field_blur('admin_email', new_admin_email)}
											className={input_class('admin_email')}
										/>
										{touched.admin_email && field_errors.admin_email && (
											<p className="mt-1 text-xs text-red-500">{field_errors.admin_email}</p>
										)}
									</div>
									<div>
										<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Password</label>
										<input
											type="password" placeholder="password" value={new_admin_password}
											onChange={(e) => handle_field_change('admin_password', e.target.value, set_new_admin_password)}
											onBlur={() => handle_field_blur('admin_password', new_admin_password)}
											className={input_class('admin_password')}
										/>
										{touched.admin_password && field_errors.admin_password && (
											<p className="mt-1 text-xs text-red-500">{field_errors.admin_password}</p>
										)}
										<p className="mt-1 text-[10px] text-slate-400">Min 8 chars, uppercase, lowercase, number, special character</p>
									</div>
									<div className="col-span-2">
										<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display Name (optional)</label>
										<input
											placeholder="Full Name" value={new_admin_display}
											onChange={(e) => set_new_admin_display(e.target.value)}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
										/>
									</div>
								</div>
							</div>
						)}
					</div>

					{action_error && <p className="mt-3 text-xs text-red-500">{action_error}</p>}
					<div className="mt-3 flex gap-2">
						<button
							onClick={handle_create}
							className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
						>
							Create
						</button>
						<button
							onClick={() => { reset_create_form(); set_action_error(''); }}
							className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
				<table className="w-full text-left text-sm">
					<thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
						<tr>
							<th className="px-4 py-3">Org</th>
							<th className="px-4 py-3">Members</th>
							<th className="px-4 py-3">Scopes</th>
							<th className="px-4 py-3">Created</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
					{loading && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">Loading...</td></tr>}
					{!loading && orgs.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No organizations</td></tr>}
						{!loading && orgs.map((o) => (
							<tr key={o.id} onClick={() => navigate(`/admin/orgs/${o.id}`)} className="cursor-pointer hover:bg-slate-50">
								<td className="px-4 py-3">
									<span className="font-medium text-slate-900">{o.slug}</span>
									{o.display_name !== o.slug && (
										<span className="ml-1 text-xs text-slate-600">({o.display_name})</span>
									)}
								</td>
							<td className="px-4 py-3 text-slate-700">{o.member_count}</td>
							<td className="px-4 py-3 text-slate-700">{o.scope_count}</td>
							<td className="px-4 py-3 text-slate-600">{new Date(o.created_at).toLocaleDateString()}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{total_pages > 1 && (
				<div className="mt-4 flex items-center justify-between text-sm">
					<button onClick={() => set_offset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">← Prev</button>
					<span className="text-xs text-slate-600">Page {current_page} of {total_pages}</span>
					<button onClick={() => set_offset(offset + LIMIT)} disabled={current_page >= total_pages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next →</button>
				</div>
			)}
		</div>
	);
}
