import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Trash2, Plus } from 'lucide-react';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { NewTokenBanner } from '@/components/new_token_banner';
import { Realm_settings_nav } from '@/components/realm_settings_nav';
import { format_date } from '@/lib/format_time';

interface RealmRow {
	id: string;
	slug: string;
	name: string;
	created_by: string;
	created_at: number | string;
	updated_at: number | string;
}

interface MemberRow {
	id: string;
	realm_id: string;
	member_type: 'user' | 'daemon' | 'group';
	member_id: string;
	username: string | null;
	role: string;
	created_at: number | string;
}

interface TokenPermissions {
	domains?: { realms?: string[] | '*' };
	access?: Record<string, string[]>;
}

interface TokenRow {
	id: string;
	realm_id: string;
	name: string;
	created_by: string;
	created_at: number | string;
	revoked_at: number | string | null;
	permissions?: TokenPermissions;
}

const TABS = [
	{ id: 'members', label: 'Members', path: 'settings/security/members' },
	{ id: 'tokens', label: 'Tokens', path: 'settings/security/tokens' },
] as const;

type Tab_id = (typeof TABS)[number]['id'];
type GrantRole = 'admin' | 'operator' | 'member';


function tab_from_pathname(pathname: string): Tab_id {
	const parts = pathname.split('/').filter(Boolean);
	const realms_idx = parts.indexOf('realms');
	if (realms_idx < 0) return 'members';
	const after = parts.slice(realms_idx + 2);
	if (after.length === 0) return 'members';

	// New shape: settings/{security|notifications}/{leaf}
	if (after[0] === 'settings') {
		const group = after[1];
		const leaf = after[2];
		if (group === 'security') {
			if (leaf === 'tokens') return 'tokens';
			return 'members';
		}
		return 'members';
	}

	if (after[0] === 'security') {
		if (after[1] === 'tokens') return 'tokens';
		return 'members';
	}
	return 'members';
}

function path_for_tab(tab: Tab_id): string {
	const found = TABS.find((t) => t.id === tab);
	return found?.path ?? '';
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function access_badges(permissions?: TokenPermissions): string[] {
	if (!permissions?.access) return [];
	return Object.entries(permissions.access)
		.filter(([, levels]) => Array.isArray(levels) && levels.length > 0)
		.map(([entity, levels]) => `${entity}:${levels.join('|')}`)
		.sort();
}

function matches_q(haystack: string, q: string): boolean {
	if (!q) return true;
	return haystack.toLowerCase().includes(q.toLowerCase());
}

export function Component() {
	const { slug: slug_param = '', org: org_param = '' } = useParams();
	const slug = slug_param.trim();
	const org_slug = org_param.trim();
	const auth_fetch = useOrgFetch();
	const { user } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	const [search_params] = useSearchParams();

	const tab = tab_from_pathname(location.pathname);
	const form_open = search_params.get('form') === '1';

	const [realm, set_realm] = useState<RealmRow | null>(null);
	const [members, set_members] = useState<MemberRow[]>([]);
	const [tokens, set_tokens] = useState<TokenRow[]>([]);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const realm_id = realm?.id ?? '';

	const [active_query, set_active_query] = useState('');
	const [add_open, set_add_open] = useState(false);
	const [add_search, set_add_search] = useState('');
	const [add_results, set_add_results] = useState<Array<{ id: string; username: string; display_name: string; email: string }>>([]);
	const [add_loading, set_add_loading] = useState(false);
	const [add_selected, set_add_selected] = useState<{ id: string; username: string; display_name: string; email: string } | null>(null);
	const [grant_role, set_grant_role] = useState<GrantRole>('member');
	const [granting, set_granting] = useState(false);
	const [send_invite, set_send_invite] = useState(false);
	const [pending_invites, set_pending_invites] = useState<Array<{
		id: string;
		email: string;
		role: string;
		expires_at: string;
	}>>([]);
	const [token_name, set_token_name] = useState('');
	const [creating_token, set_creating_token] = useState(false);
	const [new_token_value, set_new_token_value] = useState<string | null>(null);
	const [minted_realm_ids, set_minted_realm_ids] = useState<string[]>([]);

	const base_path = `/o/${org_slug}/realms/${slug}`;

	const set_tab = useCallback((next_tab: Tab_id, opts?: { form?: boolean }) => {
		const segment = path_for_tab(next_tab);
		const target = segment ? `${base_path}/${segment}` : base_path;
		const qs = opts?.form ? '?form=1' : '';
		navigate(`${target}${qs}`);
		set_error(null);
		if (next_tab !== 'members') set_add_open(false);
	}, [base_path, navigate]);

	const close_form = useCallback(() => {
		const next = new URLSearchParams(search_params);
		next.delete('form');
		const q = next.toString();
		navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
		set_error(null);
	}, [location.pathname, navigate, search_params]);

	function close_add() {
		set_add_open(false);
		set_add_search('');
		set_add_results([]);
		set_add_selected(null);
		set_send_invite(false);
		set_error(null);
	}

	useEffect(() => {
		if (search_params.get('form') !== '1') return;
		if (tab !== 'members') return;
		const next = new URLSearchParams(search_params);
		next.delete('form');
		const q = next.toString();
		navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
		set_add_open(true);
	}, [search_params, tab, location.pathname, navigate]);

	const load = useCallback(async () => {
		if (!slug) {
			set_loading(false);
			set_error('No realm selected. Open a realm from the realms list.');
			set_realm(null);
			return;
		}
		set_loading(true);
		try {
			const realm_res = await auth_fetch('/v1/realms/get_by_id', {
				method: 'POST',
				body: JSON.stringify({ slug, org_slug: org_slug || undefined }),
			});
			const realm_data = await realm_res.json();
			if (!realm_data.ok) {
				set_error(api_error_message(realm_data));
				set_realm(null);
				return;
			}
			const loaded = realm_data.realm as RealmRow;
			set_realm(loaded);

			const members_body: Record<string, string> = {
				realm_id: loaded.id,
				member_type: 'user',
			};

			const [members_res, tokens_res] = await Promise.all([
				auth_fetch('/v1/realms/get_members', {
					method: 'POST',
					body: JSON.stringify(members_body),
				}),
				auth_fetch('/v1/auth/get_tokens', {
					method: 'POST',
					body: JSON.stringify({ type: 'realm', realm_id: loaded.id }),
				}),
			]);

			const members_data = await members_res.json();
			if (members_data.ok) set_members(members_data.members ?? []);

			const tokens_data = await tokens_res.json();
			if (tokens_data.ok) {
				set_tokens(tokens_data.data?.tokens ?? tokens_data.tokens ?? []);
			}

			set_error(null);
		} catch {
			set_error('Failed to load realm');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, slug, org_slug]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (tab !== 'members') return;
		if (!realm_id) return;
		void load_invites();
	}, [tab, realm_id]);

	async function load_invites() {
		if (!realm_id) {
			set_pending_invites([]);
			return;
		}
		try {
			const res = await auth_fetch('/v1/invitations/get', {
				method: 'POST',
				body: JSON.stringify({ target_type: 'realm', realm_id }),
			});
			const data = await res.json();
			if (!data.ok) return;
			set_pending_invites(data.data?.invites ?? data.invites ?? []);
		} catch {
			/* ignore */
		}
	}

	/** Dynamic user search for the add-member picklist. */
	async function search_add_users(query: string) {
		set_add_search(query);
		set_add_selected(null);
		const q = query.trim().replace(/^@+/, '');
		if (q.length < 2 || !realm_id) {
			set_add_results([]);
			return;
		}
		set_add_loading(true);
		try {
			const res = await auth_fetch('/v1/users/get', {
				method: 'POST',
				body: JSON.stringify({ realm_id, query: q }),
			});
			const data = await res.json();
			const users = data.data?.users ?? data.users ?? [];
			set_add_results(data.ok ? users : []);
		} catch {
			set_add_results([]);
		} finally {
			set_add_loading(false);
		}
	}

	async function handle_add_member() {
		if (!add_selected) return;
		set_granting(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/realms/add_member', {
				method: 'POST',
				body: JSON.stringify({
					realm_id,
					member_type: 'user',
					member_id: String(add_selected.id),
					role: grant_role,
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			if (send_invite) {
				await auth_fetch('/v1/invitations/create', {
					method: 'POST',
					body: JSON.stringify({
						target_type: 'realm',
						realm_id,
						email: add_selected.email,
						role: grant_role,
					}),
				});
			}
			close_add();
			await Promise.all([load(), load_invites()]);
		} catch {
			set_error('Failed to add member');
		} finally {
			set_granting(false);
		}
	}

	async function handle_revoke_invite(invite_id: string) {
		set_error(null);
		try {
			const res = await auth_fetch('/v1/invitations/revoke', {
				method: 'POST',
				body: JSON.stringify({ target_type: 'realm', invite_id }),
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

	async function handle_revoke_member(row: MemberRow) {
		set_error(null);
		try {
			const res = await auth_fetch('/v1/realms/remove_member', {
				method: 'POST',
				body: JSON.stringify({
					realm_id,
					member_type: row.member_type,
					member_id: row.member_id,
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await load();
		} catch {
			set_error('Failed to revoke membership');
		}
	}

	async function handle_mint_token() {
		const name = token_name.trim();
		if (!name) {
			set_error('Token name is required');
			return;
		}
		set_creating_token(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/auth/generate_token', {
				method: 'POST',
				body: JSON.stringify({ type: 'realm', realm_ids: [realm_id], name }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_new_token_value(data.data?.token ?? data.token ?? null);
			set_minted_realm_ids(data.data?.realm_ids ?? [realm_id]);
			set_token_name('');
			await load();
		} catch {
			set_error('Failed to create realm token');
		} finally {
			set_creating_token(false);
		}
	}

	async function handle_revoke_token(token_id: string) {
		set_error(null);
		try {
			const res = await auth_fetch('/v1/auth/revoke_token', {
				method: 'POST',
				body: JSON.stringify({ type: 'realm', realm_id, token_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_new_token_value(null);
			await load();
		} catch {
			set_error('Failed to revoke token');
		}
	}

	if (loading) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading realm...</p>
			</div>
		);
	}

	if (!realm) {
		return (
			<div>
				<ApiErrorBanner error={error ?? 'Realm not found'} />
				<Link to="/realms" className="mt-4 inline-block text-sm text-indigo-600">
					← Back to realms
				</Link>
			</div>
		);
	}

	const filtered_members = members.filter((m) =>
		matches_q(`${m.member_id} ${m.username ?? ''} ${m.member_type} ${m.role}`, active_query),
	);
	const active_tokens = tokens.filter((t) => !t.revoked_at);
	const filtered_tokens = active_tokens.filter((t) => matches_q(t.name, active_query));
	return (
		<div>
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			<div className="flex flex-col gap-5 md:flex-row md:gap-6">
				<Realm_settings_nav base_path={base_path} />
				<div className="min-w-0 flex-1">

			{tab === 'members' ? (
				<div>
					<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Realm members</h2>
							<p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
								Grant access to users and manage their roles on this realm.
							</p>
						</div>
						<button
							type="button"
							onClick={() => add_open ? close_add() : set_add_open(true)}
							className="inline-flex items-center gap-1.5 self-start rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
							aria-label={add_open ? 'Cancel' : 'Add member'}
						>
							<Plus className={`h-4 w-4 transition-transform ${add_open ? 'rotate-45' : ''}`} />
							{add_open ? 'Cancel' : 'Add member'}
						</button>
					</div>

					{add_open && (
						<div className="relative mb-4">
							<div className="flex items-center gap-2">
								<div className="relative flex-1">
									<input
										value={add_search}
										onChange={(e) => void search_add_users(e.target.value)}
										placeholder="Search users by @handle or name"
										aria-label="Search users"
										className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
										autoFocus
									/>
									{add_loading && (
										<span className="absolute right-3 top-2.5 text-xs text-slate-400">Searching…</span>
									)}
									{add_results.length > 0 && !add_selected && (
										<ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
											{add_results.map((u) => (
												<li key={u.id}>
													<button
														type="button"
														onClick={() => { set_add_selected(u); set_add_results([]); set_add_search(`@${u.username}`); }}
														className="w-full px-3 py-2 text-left text-sm hover:bg-indigo-50"
													>
														<span className="font-semibold">@{u.username}</span>
														{u.display_name ? (
															<span className="ml-1 text-slate-500">{u.display_name}</span>
														) : null}
													</button>
												</li>
											))}
										</ul>
									)}
								</div>
								<select
									value={grant_role}
									onChange={(e) => set_grant_role(e.target.value as GrantRole)}
									aria-label="Role"
									className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
								>
									<option value="member">member</option>
									<option value="operator">operator</option>
									<option value="admin">admin</option>
								</select>
								<label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
									<input
										type="checkbox"
										checked={send_invite}
										onChange={(e) => set_send_invite(e.target.checked)}
										className="rounded border-slate-300"
									/>
									Send invite
								</label>
								<button
									type="button"
									onClick={() => void handle_add_member()}
									disabled={granting || !add_selected}
									className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
								>
									{granting ? 'Adding…' : 'Add'}
								</button>
							</div>

							{add_selected && (
								<div className="mt-3 flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
									<div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
										{add_selected.username[0]?.toUpperCase()}
									</div>
									<div className="min-w-0">
										<p className="text-sm font-semibold text-slate-900">@{add_selected.username}</p>
										{add_selected.display_name && (
											<p className="text-xs text-slate-500">{add_selected.display_name}</p>
										)}
										<p className="text-xs text-slate-400">{add_selected.email}</p>
									</div>
									<span className="ml-auto rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{grant_role}</span>
								</div>
							)}
						</div>
					)}

					<div className="mb-4">
						<input
							value={active_query}
							onChange={(e) => set_active_query(e.target.value)}
							placeholder="Search by name"
							aria-label="Search members"
							className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
						/>
					</div>

					{pending_invites.length > 0 && (
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
												· {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
											</span>
										</span>
										<button
											type="button"
											onClick={() => void handle_revoke_invite(inv.id)}
											className="text-slate-400 hover:text-red-600"
											aria-label="Revoke invite"
										>
											<Trash2 className="h-4 w-4" />
										</button>
									</li>
								))}
							</ul>
						</div>
					)}

					<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
						{filtered_members.length === 0 ? (
							<p className="px-5 py-8 text-sm text-slate-400">
								{active_query ? 'No members match this filter.' : 'No members yet.'}
							</p>
						) : (
							<div className="divide-y divide-slate-50 text-sm">
								{filtered_members.map((m) => (
									<div key={m.id} className="flex items-center justify-between px-5 py-3">
										<div>
											<span className="font-semibold text-slate-800">
												{m.username ? `@${m.username}` : m.member_id}
											</span>
											<span className="ml-2 text-xs text-slate-400">{m.member_type}</span>
										</div>
										<div className="flex items-center gap-3">
											<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{m.role}</span>
											<button
												type="button"
												onClick={() => handle_revoke_member(m)}
												className="text-slate-400 hover:text-red-600"
												aria-label="Remove member"
											>
												<Trash2 className="h-4 w-4" />
											</button>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			) : null}

			{tab === 'tokens' && form_open ? (
				<div>
					<button type="button" onClick={close_form} className="text-xs font-medium text-indigo-600 hover:underline">
						← Back to realm tokens
					</button>
					<h2 className="mt-3 text-xl font-semibold tracking-tight">Mint realm token</h2>
					<p className="mt-1 max-w-2xl text-sm text-slate-500">
						Creates <code className="rounded bg-slate-100 px-1">cliq_dt_…</code> for this realm. Shown once.
					</p>
					<div className="mt-6 grid gap-8 xl:grid-cols-12">
						<div className="space-y-4 xl:col-span-7">
							<div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
								<label className="block text-xs font-semibold text-slate-600">
									Token name
									<input
										value={token_name}
										onChange={(e) => set_token_name(e.target.value)}
										placeholder="laptop-enroll"
										className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
										onKeyDown={(e) => e.key === 'Enter' && handle_mint_token()}
									/>
								</label>
								{new_token_value ? (
									<NewTokenBanner
										token={new_token_value}
										env_var="CLIQ_DAEMON_TOKEN"
										permissions_summary={
											minted_realm_ids.length > 0 ? (
												<p className="text-xs text-amber-800">
													Realms:{' '}
													{minted_realm_ids.map((id, i) => (
														<span key={id}>
															{i > 0 ? ', ' : null}
															{id === realm_id ? (
																<Link to={base_path} className="font-semibold underline">
																	{slug}
																</Link>
															) : (
																<span className="font-mono">{id.slice(0, 8)}…</span>
															)}
														</span>
													))}
												</p>
											) : null
										}
									/>
								) : (
									<pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-100">
{`export CLIQ_DAEMON_TOKEN=cliq_dt_••••••••
cliq-daemon start`}
									</pre>
								)}
								<div className="flex gap-3 pt-2">
									<button
										type="button"
										onClick={handle_mint_token}
										disabled={creating_token}
										className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
									>
										{creating_token ? 'Minting…' : 'Mint'}
									</button>
									<button
										type="button"
										onClick={close_form}
										className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold"
									>
										{new_token_value ? 'Done' : 'Cancel'}
									</button>
								</div>
							</div>
						</div>
						<aside className="xl:col-span-5">
							<div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
								<p className="font-semibold text-slate-800">Realm vs user token</p>
								<p className="mt-2">
									<code className="rounded bg-white px-1 text-xs">cliq_dt_…</code> enrolls a daemon.{' '}
									<code className="rounded bg-white px-1 text-xs">cliq_pat_…</code> logs a person into Hub.
								</p>
							</div>
						</aside>
					</div>
				</div>
			) : null}

			{tab === 'tokens' && !form_open ? (
				<div>
					<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<h2 className="text-sm font-semibold">Realm tokens</h2>
							<p className="mt-1 max-w-2xl text-xs text-slate-500">
								<code className="rounded bg-slate-100 px-1">cliq_dt_…</code> →{' '}
								<code className="rounded bg-slate-100 px-1">CLIQ_DAEMON_TOKEN</code>.
								User PATs: <Link to="/tokens" className="font-medium text-indigo-600 hover:underline">User tokens</Link>.
							</p>
						</div>
						<button
							type="button"
							onClick={() => set_tab('tokens', { form: true })}
							className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
						>
							Mint realm token
						</button>
					</div>
					<div className="mb-4">
						<input
							value={active_query}
							onChange={(e) => set_active_query(e.target.value)}
							placeholder="Search by name"
							aria-label="Search tokens"
							className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
						/>
					</div>
					<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
						{filtered_tokens.length === 0 ? (
							<p className="px-5 py-8 text-sm text-slate-400">
								{active_query ? 'No tokens match this filter.' : 'No active realm tokens for this realm.'}
							</p>
						) : (
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
										<th className="px-5 py-2">Name</th>
										<th className="px-5 py-2">Created</th>
										<th className="px-5 py-2">Access</th>
										<th className="px-5 py-2" />
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-50">
									{filtered_tokens.map((t) => {
										const badges = access_badges(t.permissions);
										return (
											<tr key={t.id}>
												<td className="px-5 py-3 font-semibold">{t.name}</td>
												<td className="px-5 py-3 text-xs text-slate-500">{format_date(t.created_at)}</td>
												<td className="px-5 py-3">
													{badges.length === 0 ? (
														<span className="text-xs text-slate-400">—</span>
													) : (
														<div className="flex flex-wrap gap-1">
															{badges.map((b) => (
																<span key={b} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
																	{b}
																</span>
															))}
														</div>
													)}
												</td>
												<td className="px-5 py-3 text-right">
													<button
														type="button"
														onClick={() => handle_revoke_token(t.id)}
														className="text-xs font-semibold text-red-600 hover:underline"
													>
														Revoke
													</button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</div>
				</div>
			) : null}

				</div>
			</div>
		</div>
	);
}
