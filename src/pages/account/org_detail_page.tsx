import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Trash2 } from 'lucide-react';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Account_mesh_settings_panel } from '@/pages/account/account_mesh_settings_panel';

interface Member {
	user_id: string;
	username: string;
	display_name: string;
	email: string;
	role: string;
}

interface OrgScope {
	id: string;
	slug: string;
	display_name: string;
	visibility: string;
	member_count: number;
	team_count: number;
}

interface OrgDetail {
	id: string;
	slug: string;
	display_name: string;
	created_at: string;
	my_role: string;
	members: Member[];
	scopes: OrgScope[];
}

const TABS = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'members', label: 'Members' },
	{ id: 'scopes', label: 'Scopes' },
	{ id: 'mesh', label: 'A2A' },
	{ id: 'settings', label: 'Settings' },
] as const;

type Tab_id = (typeof TABS)[number]['id'];

function resolve_tab(raw: string | null): Tab_id {
	const found = TABS.find((t) => t.id === raw);
	if (found) return found.id;
	return 'overview';
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

export function Component() {
	const { user } = useAuth();
	const auth_fetch = useOrgFetch();
	const navigate = useNavigate();
	const params = useParams();
	const org_id = params.id ?? '';
	const [search_params, set_search_params] = useSearchParams();
	const tab = resolve_tab(search_params.get('tab'));
	const [invite_open, set_invite_open] = useState(false);

	const [org, set_org] = useState<OrgDetail | null>(null);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);

	const [member_query_draft, set_member_query_draft] = useState('');
	const [member_query, set_member_query] = useState('');
	const [members, set_members] = useState<Member[]>([]);
	const [members_loading, set_members_loading] = useState(false);

	const [add_username, set_add_username] = useState('');
	const [adding, set_adding] = useState(false);
	const [invite_email, set_invite_email] = useState('');
	const [inviting, set_inviting] = useState(false);
	const [search_query, set_search_query] = useState('');
	const [search_results, set_search_results] = useState<Array<{
		id: string;
		username: string;
		display_name: string;
		email: string;
	}>>([]);
	const [search_loading, set_search_loading] = useState(false);
	const [pending_invites, set_pending_invites] = useState<Array<{
		id: string;
		email: string;
		role: string;
		expires_at: string;
	}>>([]);
	const [last_invite_link, set_last_invite_link] = useState<string | null>(null);

	const [manage_member, set_manage_member] = useState<Member | null>(null);
	const [manage_display_name, set_manage_display_name] = useState('');
	const [manage_email, set_manage_email] = useState('');
	const [manage_password, set_manage_password] = useState('');
	const [manage_saving, set_manage_saving] = useState(false);
	const [manage_resetting, set_manage_resetting] = useState(false);

	const [creating_scope, set_creating_scope] = useState(false);
	const [scope_slug, set_scope_slug] = useState('');
	const [scope_display, set_scope_display] = useState('');
	const [scope_visibility, set_scope_visibility] = useState<'public' | 'private'>('public');
	const [expanded_scope, set_expanded_scope] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await auth_fetch('/v1/orgs/get_by_id', {
				method: 'POST',
				body: JSON.stringify({ org_id }),
			});
			const data = await res.json();
			if (data.ok) {
				set_org(data.data);
				set_error(null);
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Network error');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, org_id]);

	const load_members = useCallback(async () => {
		set_members_loading(true);
		try {
			const body: Record<string, unknown> = { org_id, limit: 100, offset: 0 };
			const query = member_query.trim();
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
			const rows = (data.data?.users ?? []) as Array<{
				id: string;
				username: string;
				display_name: string;
				email?: string;
				org_role?: string;
			}>;
			set_members(rows.map((u) => ({
				user_id: String(u.id),
				username: u.username,
				display_name: u.display_name,
				email: u.email ?? '',
				role: u.org_role ?? 'member',
			})));
			set_error(null);
		} catch {
			set_error('Failed to load members');
		} finally {
			set_members_loading(false);
		}
	}, [auth_fetch, org_id, member_query]);

	useEffect(() => {
		void load();
	}, [load]);

	const is_admin = org?.my_role === 'admin' || org?.my_role === 'site_admin';

	useEffect(() => {
		if (tab !== 'members') return;
		void load_members();
	}, [tab, load_members]);

	useEffect(() => {
		if (tab !== 'members') return;
		if (!is_admin) return;
		void load_invites();
	}, [tab, is_admin, org_id]);

	useEffect(() => {
		if (search_params.get('form') !== '1') return;
		const params_next = new URLSearchParams(search_params);
		params_next.delete('form');
		if (!params_next.get('tab')) params_next.set('tab', 'members');
		set_search_params(params_next, { replace: true });
		set_invite_open(true);
	}, [search_params, set_search_params]);

	function set_tab(next: Tab_id) {
		const params_next = new URLSearchParams(search_params);
		params_next.set('tab', next);
		params_next.delete('form');
		set_search_params(params_next, { replace: false });
		set_error(null);
		if (next !== 'members') set_invite_open(false);
	}

	function close_invite() {
		set_invite_open(false);
		set_search_query('');
		set_search_results([]);
		set_add_username('');
		set_invite_email('');
		set_last_invite_link(null);
		set_error(null);
	}

	function apply_member_filter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw = new FormData(form).get('query');
		const query = typeof raw === 'string' ? raw.trim() : member_query_draft.trim();
		set_member_query_draft(query);
		set_member_query(query);
	}

	async function handle_add_member(user_id?: string, username?: string) {
		const target_username = (username ?? add_username).trim();
		if (user_id == null && !target_username) {
			set_error('Select a user or enter a username');
			return;
		}
		set_adding(true);
		set_error(null);
		try {
			const body = user_id != null
				? { org_id, user_id }
				: { org_id, username: target_username };
			const res = await auth_fetch('/v1/orgs/add_member', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_add_username('');
			set_search_query('');
			set_search_results([]);
			set_invite_open(false);
			await Promise.all([load(), load_members(), load_invites()]);
		} catch {
			set_error('Failed to add member');
		} finally {
			set_adding(false);
		}
	}

	async function search_users_for_invite(query: string) {
		set_search_query(query);
		if (query.trim().length < 2) {
			set_search_results([]);
			return;
		}
		set_search_loading(true);
		try {
			const res = await auth_fetch('/v1/users/get', {
				method: 'POST',
				body: JSON.stringify({ org_id, query: query.trim() }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_search_results([]);
				return;
			}
			const rows = (data.data?.users ?? []) as Array<{
				id: string;
				username: string;
				display_name: string;
				email?: string;
			}>;
			set_search_results(rows.map((u) => ({
				id: String(u.id),
				username: u.username,
				display_name: u.display_name,
				email: u.email ?? '',
			})));
		} catch {
			set_search_results([]);
		} finally {
			set_search_loading(false);
		}
	}

	async function load_invites() {
		if (!is_admin) {
			set_pending_invites([]);
			return;
		}
		try {
			const res = await auth_fetch('/v1/invitations/get', {
				method: 'POST',
				body: JSON.stringify({ target_type: 'org', org_id }),
			});
			const data = await res.json();
			if (!data.ok) return;
			set_pending_invites(data.data.invites ?? []);
		} catch {
			/* ignore */
		}
	}

	async function handle_invite_email() {
		const email = invite_email.trim().toLowerCase();
		if (!email) {
			set_error('Email is required');
			return;
		}
		set_inviting(true);
		set_error(null);
		set_last_invite_link(null);
		try {
			const res = await auth_fetch('/v1/invitations/create', {
				method: 'POST',
				body: JSON.stringify({ target_type: 'org', org_id, email }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_invite_email('');
			if (data.data.status === 'pending' && data.data.token) {
				set_last_invite_link(`${window.location.origin}/invite/${data.data.token}`);
			}
			if (data.data.status === 'added') {
				set_invite_open(false);
				await Promise.all([load(), load_members()]);
			}
			await load_invites();
		} catch {
			set_error('Failed to create invite');
		} finally {
			set_inviting(false);
		}
	}

	async function handle_revoke_invite(invite_id: string) {
		set_error(null);
		try {
			const res = await auth_fetch('/v1/invitations/revoke', {
				method: 'POST',
				body: JSON.stringify({ target_type: 'org', invite_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await load_invites();
		} catch {
			set_error('Failed to revoke invite');
		}
	}

	async function handle_remove_member(user_id: string) {
		if (!confirm('Remove this member from the account?')) return;
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
			await Promise.all([load(), load_members()]);
		} catch {
			set_error('Failed to remove member');
		}
	}

	async function handle_set_role(user_id: string, role: 'admin' | 'member') {
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
			await Promise.all([load(), load_members()]);
		} catch {
			set_error('Failed to update role');
		}
	}

	function open_manage_member(member: Member) {
		set_manage_member(member);
		set_manage_display_name(member.display_name);
		set_manage_email(member.email);
		set_manage_password('');
		set_error(null);
	}

	function close_manage_member() {
		set_manage_member(null);
		set_manage_password('');
		set_error(null);
	}

	async function handle_save_member_profile() {
		if (!manage_member) return;
		set_manage_saving(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/users/update', {
				method: 'POST',
				body: JSON.stringify({
					user_id: manage_member.user_id,
					display_name: manage_display_name.trim(),
					email: manage_email.trim(),
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await load_members();
			close_manage_member();
		} catch {
			set_error('Failed to update profile');
		} finally {
			set_manage_saving(false);
		}
	}

	async function handle_reset_member_password() {
		if (!manage_member) return;
		const password = manage_password.trim();
		if (password.length < 8) {
			set_error('Password must be at least 8 characters');
			return;
		}
		set_manage_resetting(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/users/reset_password', {
				method: 'POST',
				body: JSON.stringify({
					user_id: manage_member.user_id,
					new_password: password,
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_manage_password('');
			set_error(null);
			alert(`Password reset for @${manage_member.username}`);
		} catch {
			set_error('Failed to reset password');
		} finally {
			set_manage_resetting(false);
		}
	}

	async function handle_leave() {
		if (!confirm('Leave this account? You will lose access to its scopes.')) return;
		set_error(null);
		try {
			const res = await auth_fetch('/v1/orgs/leave', {
				method: 'POST',
				body: JSON.stringify({ org_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			navigate('/organizations');
		} catch {
			set_error('Failed to leave org');
		}
	}

	async function handle_create_scope() {
		if (!org) return;
		const full_slug = scope_slug ? `${org.slug}-${scope_slug}` : '';
		set_error(null);
		try {
			const res = await auth_fetch('/v1/scopes/new', {
				method: 'POST',
				body: JSON.stringify({
					org_id,
					slug: full_slug,
					display_name: scope_display || undefined,
					visibility: scope_visibility,
					scope_type: 'org',
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_scope_slug('');
			set_scope_display('');
			set_scope_visibility('public');
			set_creating_scope(false);
			await load();
		} catch {
			set_error('Failed to create scope');
		}
	}

	async function handle_delete_scope(scope_id: string, slug: string) {
		if (!confirm(`Delete scope @${slug}? This cannot be undone.`)) return;
		set_error(null);
		try {
			const res = await auth_fetch('/v1/scopes/delete', {
				method: 'POST',
				body: JSON.stringify({ scope_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await load();
		} catch {
			set_error('Failed to delete scope');
		}
	}

	async function handle_assign_scope(scope_id: string, user_id: string) {
		set_error(null);
		try {
			const res = await auth_fetch('/v1/scopes/add_user', {
				method: 'POST',
				body: JSON.stringify({ scope_id, user_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await load();
		} catch {
			set_error('Failed to assign member');
		}
	}

	async function handle_unassign_scope(scope_id: string, user_id: string) {
		set_error(null);
		try {
			const res = await auth_fetch('/v1/scopes/remove_user', {
				method: 'POST',
				body: JSON.stringify({ scope_id, user_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await load();
		} catch {
			set_error('Failed to unassign member');
		}
	}

	if (loading) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading...</p>
			</div>
		);
	}

	if (!org) {
		return (
			<div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
				<p className="text-sm text-red-500">{error || 'Org not found'}</p>
				<button
					type="button"
					onClick={() => navigate('/organizations')}
					className="text-sm text-indigo-600 hover:underline"
				>
					Back to My Organizations
				</button>
			</div>
		);
	}

	return (
		<div>
			<Breadcrumbs
				items={[
					{ label: 'Organizations', to: '/organizations' },
					{ label: org.display_name },
				]}
			/>
			<Link
				to="/organizations"
				className="text-xs font-medium text-indigo-600 hover:underline"
			>
				← My Organizations
			</Link>

			<div className="mt-2 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-extrabold tracking-tight">{org.display_name}</h1>
					<p className="mt-1 text-sm text-slate-500">
						@{org.slug} · Org defaults for agent variables. Realms inherit unless they override.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
						{org.my_role}
					</span>
					{!is_admin && (
						<button
							type="button"
							onClick={() => void handle_leave()}
							className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
						>
							Leave
						</button>
					)}
				</div>
			</div>

			<div className="mt-6 flex gap-1 border-b border-slate-200">
				{TABS.map((t) => {
					const active = t.id === tab;
					return (
						<button
							key={t.id}
							type="button"
							onClick={() => set_tab(t.id)}
							className={`-mb-px border-b-2 px-3 py-2 text-sm ${
								active
									? 'border-indigo-600 font-semibold text-indigo-700'
									: 'border-transparent font-medium text-slate-500 hover:text-slate-800'
							}`}
						>
							{t.label}
						</button>
					);
				})}
			</div>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{tab === 'overview' && (
				<div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
					<div className="rounded-xl border border-slate-200 p-4">
						<p className="text-xs text-slate-500">Users</p>
						<p className="mt-1 text-2xl font-semibold">{org.members.length}</p>
					</div>
					<div className="rounded-xl border border-slate-200 p-4">
						<p className="text-xs text-slate-500">Scopes</p>
						<p className="mt-1 text-2xl font-semibold">{org.scopes.length}</p>
					</div>
					<div className="rounded-xl border border-slate-200 p-4">
						<p className="text-xs text-slate-500">Realms</p>
						<p className="mt-1 text-sm font-semibold text-indigo-600">
							<Link to="/realms" className="hover:underline">View realms →</Link>
						</p>
					</div>
				</div>
			)}

			{tab === 'members' && manage_member ? (
				<div className="mt-5">
					<button
						type="button"
						onClick={close_manage_member}
						className="text-xs font-medium text-indigo-600 hover:underline"
					>
						← Back to members
					</button>
					<h2 className="mt-3 text-xl font-semibold tracking-tight">
						Manage @{manage_member.username}
					</h2>
					<p className="mt-1 text-sm text-slate-500">
						Update profile or reset password for this account member.
					</p>

					<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

					<div className="mt-6 grid max-w-xl gap-6">
						<div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							<h3 className="text-sm font-semibold text-slate-800">Profile</h3>
							<label className="block text-xs font-semibold text-slate-600">
								Display name
								<input
									value={manage_display_name}
									onChange={(e) => set_manage_display_name(e.target.value)}
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
								/>
							</label>
							<label className="block text-xs font-semibold text-slate-600">
								Email
								<input
									type="email"
									value={manage_email}
									onChange={(e) => set_manage_email(e.target.value)}
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
								/>
							</label>
							<button
								type="button"
								onClick={() => void handle_save_member_profile()}
								disabled={manage_saving}
								className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
							>
								{manage_saving ? 'Saving…' : 'Save profile'}
							</button>
						</div>

						<div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							<h3 className="text-sm font-semibold text-slate-800">Reset password</h3>
							<label className="block text-xs font-semibold text-slate-600">
								New password
								<input
									type="password"
									value={manage_password}
									onChange={(e) => set_manage_password(e.target.value)}
									placeholder="At least 8 characters"
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
								/>
							</label>
							<button
								type="button"
								onClick={() => void handle_reset_member_password()}
								disabled={manage_resetting || manage_password.trim().length < 8}
								className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
							>
								{manage_resetting ? 'Resetting…' : 'Reset password'}
							</button>
						</div>
					</div>
				</div>
			) : null}

			{tab === 'members' && !manage_member && (
				<div className="mt-5">
					<div className="mb-4 flex items-start justify-between gap-4">
						<div>
							<h2 className="text-sm font-semibold">Members</h2>
							<p className="mt-1 text-xs text-slate-500">People in this account.</p>
						</div>
						{is_admin && (
							<button
								type="button"
								onClick={() => set_invite_open((open) => !open)}
								className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
							>
								{invite_open ? 'Close invite' : 'Invite'}
							</button>
						)}
					</div>

					{is_admin && invite_open && (
						<div className="mb-4 max-w-2xl space-y-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-5">
							<div>
								<h3 className="text-sm font-semibold text-slate-900">Invite people</h3>
								<p className="mt-1 text-xs text-slate-500">
									Add an existing Hub user, or invite by email. New people join this
									organization only.
								</p>
							</div>

							<div>
								<label className="block text-xs font-semibold text-slate-600">
									Search existing users
									<input
										value={search_query}
										onChange={(e) => void search_users_for_invite(e.target.value)}
										placeholder="username, email, or name"
										aria-label="Search users"
										className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
										autoFocus
									/>
								</label>
								{search_loading && (
									<p className="mt-2 text-xs text-slate-400">Searching…</p>
								)}
								{search_results.length > 0 && (
									<ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
										{search_results.map((u) => (
											<li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
												<div className="min-w-0">
													<p className="truncate text-sm font-semibold">
														{u.display_name || u.username}
													</p>
													<p className="truncate text-xs text-slate-500">
														@{u.username} · {u.email}
													</p>
												</div>
												<button
													type="button"
													disabled={adding}
													onClick={() => void handle_add_member(u.id, u.username)}
													className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
												>
													Add
												</button>
											</li>
										))}
									</ul>
								)}
							</div>

							<div className="border-t border-indigo-100/80 pt-4">
								<label className="block text-xs font-semibold text-slate-600">
									Or add by username
									<input
										value={add_username}
										onChange={(e) => set_add_username(e.target.value)}
										onKeyDown={(e) => e.key === 'Enter' && void handle_add_member()}
										placeholder="alex"
										aria-label="Member username"
										className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
									/>
								</label>
								<button
									type="button"
									onClick={() => void handle_add_member()}
									disabled={adding || !add_username.trim()}
									className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
								>
									{adding ? 'Adding…' : 'Add by username'}
								</button>
							</div>

							<div className="border-t border-indigo-100/80 pt-4">
								<label className="block text-xs font-semibold text-slate-600">
									Invite by email
									<input
										type="email"
										value={invite_email}
										onChange={(e) => set_invite_email(e.target.value)}
										onKeyDown={(e) => e.key === 'Enter' && void handle_invite_email()}
										placeholder="colleague@company.com"
										aria-label="Invite email"
										className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
									/>
								</label>
								<p className="mt-1 text-xs text-slate-500">
									Existing users are added immediately. Otherwise you get a shareable
									invite link to send them (Slack, email, etc.).
								</p>
								<button
									type="button"
									onClick={() => void handle_invite_email()}
									disabled={inviting || !invite_email.trim()}
									className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
								>
									{inviting ? 'Inviting…' : 'Create invite'}
								</button>
								{last_invite_link && (
									<div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
										<p className="font-semibold">Invite link — copy & share</p>
										<p className="mt-1 break-all">{last_invite_link}</p>
									</div>
								)}
							</div>

							<p className="border-t border-indigo-100/80 pt-3 text-xs text-slate-500">
								Run and review alerts are separate — configure channels under{' '}
								<Link to="/settings?tab=notifications" className="font-medium text-indigo-600 hover:underline">
									Settings → Notifications
								</Link>
								{' '}or the bell in the top bar.
							</p>

							<button
								type="button"
								onClick={close_invite}
								className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold"
							>
								Done
							</button>
						</div>
					)}

					{is_admin && pending_invites.length > 0 && (
						<div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
							<h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
								Pending invites
							</h3>
							<ul className="mt-2 space-y-2">
								{pending_invites.map((inv) => (
									<li
										key={inv.id}
										className="flex items-center justify-between gap-3 text-sm"
									>
										<span>
											{inv.email}{' '}
											<span className="text-xs text-amber-700/80">
												· expires {new Date(inv.expires_at).toLocaleDateString()}
											</span>
										</span>
										<button
											type="button"
											onClick={() => void handle_revoke_invite(inv.id)}
											className="text-xs font-semibold text-red-600"
										>
											Revoke
										</button>
									</li>
								))}
							</ul>
						</div>
					)}

					<form
						onSubmit={apply_member_filter}
						className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
					>
						<label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-600">
							Filter
							<input
								name="query"
								value={member_query_draft}
								onChange={(e) => set_member_query_draft(e.target.value)}
								placeholder="username or email"
								aria-label="Filter members"
								className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
							/>
						</label>
						<button
							type="submit"
							className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
						>
							Apply
						</button>
						{member_query && (
							<button
								type="button"
								onClick={() => {
									set_member_query_draft('');
									set_member_query('');
								}}
								className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
							>
								Clear
							</button>
						)}
					</form>

					{members_loading ? (
						<p className="text-sm text-slate-400">Loading members…</p>
					) : members.length === 0 ? (
						<p className="text-sm text-slate-400">
							{member_query ? 'No members match this filter.' : 'No members yet.'}
						</p>
					) : (
						<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
										<th className="px-5 py-2">User</th>
										<th className="px-5 py-2">Role</th>
										<th className="px-5 py-2" />
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-50">
									{members.map((m) => (
										<tr key={m.user_id}>
											<td className="px-5 py-3">
												<span className="font-semibold">{m.display_name}</span>{' '}
												<span className="text-slate-400">@{m.username}</span>
											</td>
											<td className="px-5 py-3">
												<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold">
													{m.role}
												</span>
											</td>
											<td className="px-5 py-3 text-right">
												{is_admin ? (
													<div className="space-x-2">
														<button
															type="button"
															onClick={() => open_manage_member(m)}
															className="text-xs font-semibold text-indigo-600"
														>
															Manage
														</button>
														{m.user_id !== user?.id ? (
															<>
																<button
																	type="button"
																	onClick={() => void handle_set_role(
																		m.user_id,
																		m.role === 'admin' ? 'member' : 'admin',
																	)}
																	className="text-xs font-semibold text-slate-500"
																>
																	{m.role === 'admin' ? 'Demote' : 'Promote'}
																</button>
																<button
																	type="button"
																	onClick={() => void handle_remove_member(m.user_id)}
																	className="text-xs font-semibold text-red-600"
																>
																	Remove
																</button>
															</>
														) : null}
													</div>
												) : null}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}

			{tab === 'scopes' && (
				<div className="mt-5">
					<div className="mb-4 flex items-center justify-between">
						<div>
							<h2 className="text-sm font-semibold">Scopes</h2>
							<p className="mt-1 text-xs text-slate-500">Package namespaces owned by this org.</p>
						</div>
						{is_admin && !creating_scope && (
							<button
								type="button"
								onClick={() => set_creating_scope(true)}
								className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
							>
								+ New Scope
							</button>
						)}
					</div>

					{is_admin && creating_scope && (
						<div className="mb-4 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
									<span className="bg-slate-100 px-3 py-2 text-sm text-slate-500">@{org.slug}-</span>
									<input
										value={scope_slug}
										onChange={(e) => set_scope_slug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
										placeholder="labs"
										aria-label="Scope slug suffix"
										className="w-full px-2 py-2 text-sm outline-none"
									/>
								</div>
								<input
									value={scope_display}
									onChange={(e) => set_scope_display(e.target.value)}
									placeholder="Display name"
									className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
								/>
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => void handle_create_scope()}
									disabled={!scope_slug}
									className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
								>
									Create
								</button>
								<button
									type="button"
									onClick={() => set_creating_scope(false)}
									className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
								>
									Cancel
								</button>
							</div>
						</div>
					)}

					<div className="divide-y overflow-hidden rounded-xl border border-slate-200 bg-white font-mono text-sm">
						{org.scopes.map((scope) => {
							const is_default = scope.slug === org.slug;
							const is_expanded = expanded_scope === scope.id;
							return (
								<div key={scope.id}>
									<div className="flex items-center justify-between px-5 py-3">
										<button
											type="button"
											onClick={() => set_expanded_scope(is_expanded ? null : scope.id)}
											className="text-left"
										>
											<span className="font-semibold">@{scope.slug}</span>
											{is_default && (
												<span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-sans text-slate-500">
													default
												</span>
											)}
										</button>
										<div className="flex items-center gap-3 font-sans text-xs text-slate-500">
											<Link to={`/browse/s/${scope.slug}`} className="font-semibold text-indigo-600">
												{scope.team_count} teams
											</Link>
											{is_admin && !is_default && (
												<button
													type="button"
													onClick={() => void handle_delete_scope(scope.id, scope.slug)}
													className="rounded p-1 text-slate-400 transition hover:text-red-600"
													title="Delete scope"
												>
													<Trash2 className="h-4 w-4" />
												</button>
											)}
										</div>
									</div>
									{is_expanded && is_admin && (
										<div className="space-y-1.5 border-t border-slate-100 bg-slate-50 px-5 py-3 font-sans">
											{org.members
												.filter((m) => m.role !== 'admin')
												.map((m) => (
													<div key={m.user_id} className="flex items-center justify-between text-xs">
														<span>@{m.username}</span>
														<div className="space-x-2">
															<button
																type="button"
																onClick={() => void handle_assign_scope(scope.id, m.user_id)}
																className="font-semibold text-emerald-700"
															>
																Grant
															</button>
															<button
																type="button"
																onClick={() => void handle_unassign_scope(scope.id, m.user_id)}
																className="font-semibold text-red-600"
															>
																Revoke
															</button>
														</div>
													</div>
												))}
										</div>
									)}
								</div>
							);
						})}
						{org.scopes.length === 0 && (
							<p className="px-5 py-8 text-center font-sans text-sm text-slate-400">No scopes yet.</p>
						)}
					</div>
				</div>
			)}

			{tab === 'mesh' && (
				<div className="mt-5">
					{org.my_role === 'admin' ? (
						<Account_mesh_settings_panel org_id={org.id} />
					) : (
						<p className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-600">
							Org admins manage mesh / A2A defaults for this organization.
						</p>
					)}
				</div>
			)}

			{tab === 'settings' && (
				<div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-600">
					<h2 className="text-sm font-semibold text-slate-800">Org agent settings</h2>
					<p className="mt-2 max-w-2xl text-xs text-slate-500">
						Org-scoped agent variable inheritance is not exposed by the Hub API yet.
						Use realm settings for overrides once that surface lands.
					</p>
					<p className="mt-4 text-xs">
						<Link to="/realms" className="font-medium text-indigo-600 hover:underline">
							Realms →
						</Link>
					</p>
				</div>
			)}
		</div>
	);
}
