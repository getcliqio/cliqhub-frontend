import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check, ChevronRight, X } from 'lucide-react';
import { useOrgFetch, useOrg } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { NewTokenBanner } from '@/components/new_token_banner';

/**
 * Multi-step wizard that runs the "create realm" flow end-to-end:
 *
 *   1. Identity  — slug + name (mandatory, creates the realm row).
 *   2. Teams     — optional; adds published teams to `realm.team_list`.
 *   3. Members   — optional; grants users + queues email invites.
 *   4. Token     — optional; mints a `cliq_dt_…` daemon-enroll token
 *                  and shows the plaintext once via <NewTokenBanner>.
 *
 * Every step past identity has "Skip" that jumps to the summary /
 * open-realm view. Backend snapshots (agent settings + notification
 * bindings from the account defaults) happen inside RealmService.create,
 * so the UI doesn't need to orchestrate them here.
 */

type Step_id = 'identity' | 'teams' | 'members' | 'token' | 'done';

interface Realm_ref {
	id: string;
	slug: string;
	org_slug: string | null;
	name: string;
}

interface Team_option {
	scope: string;
	slug: string;
	label: string;
}

interface User_option {
	id: string;
	username: string;
	display_name: string;
	email: string;
}

interface Grant_role_option {
	value: 'member' | 'operator' | 'admin';
	label: string;
}

const ROLES: Grant_role_option[] = [
	{ value: 'member', label: 'member' },
	{ value: 'operator', label: 'operator' },
	{ value: 'admin', label: 'admin' },
];

interface Realm_wizard_props {
	on_cancel: () => void;
	on_done: (realm: Realm_ref) => void;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function normalize_slug_input(raw: string): string {
	return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

export function Realm_wizard({ on_cancel, on_done }: Realm_wizard_props) {
	const auth_fetch = useOrgFetch();
	const { current_org } = useOrg();
	const navigate = useNavigate();

	const [step, set_step] = useState<Step_id>('identity');
	const [realm, set_realm] = useState<Realm_ref | null>(null);
	const [error, set_error] = useState<string | null>(null);

	// Identity step
	const [slug, set_slug] = useState('');
	const [name, set_name] = useState('');
	const [creating, set_creating] = useState(false);

	// Teams step
	const [team_options, set_team_options] = useState<Team_option[]>([]);
	const [team_options_loading, set_team_options_loading] = useState(false);
	const [team_query, set_team_query] = useState('');
	const [selected_teams, set_selected_teams] = useState<Set<string>>(new Set());
	const [saving_teams, set_saving_teams] = useState(false);

	// Members step
	const [member_query, set_member_query] = useState('');
	const [member_results, set_member_results] = useState<User_option[]>([]);
	const [member_searching, set_member_searching] = useState(false);
	const [added_members, set_added_members] = useState<Array<{
		user: User_option;
		role: Grant_role_option['value'];
	}>>([]);
	const [pending_role, set_pending_role] = useState<Grant_role_option['value']>('member');
	const [invite_email, set_invite_email] = useState('');
	const [invite_role, set_invite_role] = useState<Grant_role_option['value']>('member');
	const [sent_invites, set_sent_invites] = useState<Array<{ email: string; role: string }>>([]);
	const [busy_member, set_busy_member] = useState(false);

	// Token step
	const [token_name, set_token_name] = useState('default');
	const [minting, set_minting] = useState(false);
	const [minted_token, set_minted_token] = useState<string | null>(null);
	const [minted_realm_ids, set_minted_realm_ids] = useState<string[]>([]);

	// ── Step 1: identity ─────────────────────────────────────────────
	async function handle_create_realm() {
		const clean_slug = normalize_slug_input(slug);
		const clean_name = name.trim();
		if (!clean_slug) {
			set_error('Slug is required (a–z, 0–9, dot, dash, underscore)');
			return;
		}
		if (!clean_name) {
			set_error('Display name is required');
			return;
		}
		set_creating(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/realms/create', {
				method: 'POST',
				body: JSON.stringify({ slug: clean_slug, name: clean_name }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			const created = data.realm as Realm_ref;
			set_realm(created);
			set_step('teams');
			set_token_name(`${created.slug}-enroll`);
		} catch {
			set_error('Failed to create realm');
		} finally {
			set_creating(false);
		}
	}

	// ── Step 2: teams ────────────────────────────────────────────────
	const load_team_options = useCallback(async () => {
		set_team_options_loading(true);
		try {
			const res = await auth_fetch('/v1/teams/get', {
				method: 'POST',
				body: JSON.stringify({}),
			});
			const json = await res.json();
			if (!json.ok) return;
			const payload = json.data ?? json;
			const raw = (payload.teams ?? []) as Array<{ scope?: string | null; name?: string; slug?: string }>;

			const seen = new Set<string>();
			const options: Team_option[] = [];
			for (const t of raw) {
				const scope = (t.scope ?? '').trim();
				const inner = (t.name ?? t.slug ?? '').trim();
				if (!scope || !inner) continue;
				const label = `@${scope}/${inner}`;
				if (seen.has(label)) continue;
				seen.add(label);
				options.push({ scope, slug: inner, label });
			}
			options.sort((a, b) => a.label.localeCompare(b.label));
			set_team_options(options);
		} finally {
			set_team_options_loading(false);
		}
	}, [auth_fetch]);

	useEffect(() => {
		if (step !== 'teams') return;
		void load_team_options();
	}, [step, load_team_options]);

	function toggle_team(label: string) {
		const next = new Set(selected_teams);
		if (next.has(label)) {
			next.delete(label);
		} else {
			next.add(label);
		}
		set_selected_teams(next);
	}

	async function handle_save_teams(advance = true) {
		if (!realm) return;
		if (selected_teams.size === 0) {
			if (advance) set_step('members');
			return;
		}
		set_saving_teams(true);
		set_error(null);
		try {
			for (const label of selected_teams) {
				const opt = team_options.find((o) => o.label === label);
				if (!opt) continue;
				const res = await auth_fetch('/v1/realms/add_team', {
					method: 'POST',
					body: JSON.stringify({
						realm_id: realm.id,
						scope: opt.scope,
						slug: opt.slug,
					}),
				});
				const data = await res.json();
				if (!data.ok) {
					set_error(api_error_message(data));
					return;
				}
			}
			if (advance) set_step('members');
		} catch {
			set_error('Failed to save teams');
		} finally {
			set_saving_teams(false);
		}
	}

	// ── Step 3: members ──────────────────────────────────────────────
	async function search_members(query: string) {
		set_member_query(query);
		const q = query.trim().replace(/^@+/, '');
		if (!realm || q.length < 2) {
			set_member_results([]);
			return;
		}
		set_member_searching(true);
		try {
			const res = await auth_fetch('/v1/users/get', {
				method: 'POST',
				body: JSON.stringify({ realm_id: realm.id, query: q }),
			});
			const data = await res.json();
			if (data.ok) {
				const already = new Set(added_members.map((m) => m.user.id));
				const users = (data.data?.users ?? data.users ?? []) as User_option[];
				set_member_results(users.filter((u) => !already.has(u.id)));
				return;
			}
			set_member_results([]);
		} catch {
			set_member_results([]);
		} finally {
			set_member_searching(false);
		}
	}

	async function handle_add_member(user: User_option) {
		if (!realm) return;
		set_busy_member(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/realms/add_member', {
				method: 'POST',
				body: JSON.stringify({
					realm_id: realm.id,
					member_type: 'user',
					member_id: String(user.id),
					role: pending_role,
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_added_members((prev) => [...prev, { user, role: pending_role }]);
			set_member_results((prev) => prev.filter((u) => u.id !== user.id));
			set_member_query('');
		} catch {
			set_error('Failed to add member');
		} finally {
			set_busy_member(false);
		}
	}

	async function handle_send_invite() {
		const email = invite_email.trim().toLowerCase();
		if (!realm || !email) return;
		set_busy_member(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/invitations/create', {
				method: 'POST',
				body: JSON.stringify({
					target_type: 'realm',
					realm_id: realm.id,
					email,
					role: invite_role,
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_sent_invites((prev) => [...prev, { email, role: invite_role }]);
			set_invite_email('');
		} catch {
			set_error('Failed to send invite');
		} finally {
			set_busy_member(false);
		}
	}

	// ── Step 4: token ────────────────────────────────────────────────
	async function handle_mint_token() {
		if (!realm) return;
		const trimmed = token_name.trim();
		if (!trimmed) {
			set_error('Token name is required');
			return;
		}
		set_minting(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/auth/generate_token', {
				method: 'POST',
				body: JSON.stringify({ type: 'realm', realm_ids: [realm.id], name: trimmed }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_minted_token(data.data?.token ?? data.token ?? null);
			set_minted_realm_ids(data.data?.realm_ids ?? [realm.id]);
		} catch {
			set_error('Failed to mint token');
		} finally {
			set_minting(false);
		}
	}

	// ── Navigation helpers ───────────────────────────────────────────
	function finish() {
		if (realm) {
			on_done(realm);
			navigate(`/o/${realm.org_slug ?? 'unknown'}/realms/${realm.slug}`);
			return;
		}
		on_cancel();
	}

	const steps: Array<{ id: Exclude<Step_id, 'done'>; label: string }> = [
		{ id: 'identity', label: 'Identity' },
		{ id: 'teams', label: 'Teams' },
		{ id: 'members', label: 'Members' },
		{ id: 'token', label: 'Token' },
	];
	const step_index = steps.findIndex((s) => s.id === step);

	const filtered_team_options = team_query.trim()
		? team_options.filter((t) => t.label.toLowerCase().includes(team_query.trim().toLowerCase()))
		: team_options;

	return (
		<div>
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<button
						type="button"
						onClick={on_cancel}
						className="mb-2 text-xs font-medium text-indigo-600 hover:underline"
					>
						← Back to realms
					</button>
					<h1 className="text-2xl font-extrabold tracking-tight">Create realm</h1>
					<p className="mt-1 max-w-2xl text-sm text-slate-500">
						Set the identity, then add teams, members, and mint an enroll token — all in one flow.
					</p>
				</div>
				<button
					type="button"
					onClick={on_cancel}
					aria-label="Close wizard"
					className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			{/* Stepper */}
			<ol className="mb-6 flex flex-wrap items-center gap-2 text-xs">
				{steps.map((s, i) => {
					const done_step = i < step_index;
					const active = i === step_index;
					return (
						<li key={s.id} className="flex items-center gap-2">
							<span
								className={`flex h-6 w-6 items-center justify-center rounded-full border font-bold ${
									done_step
										? 'border-emerald-500 bg-emerald-500 text-white'
										: active
											? 'border-indigo-600 bg-indigo-600 text-white'
											: 'border-slate-300 bg-white text-slate-400'
								}`}
							>
								{done_step ? <Check className="h-3.5 w-3.5" /> : i + 1}
							</span>
							<span
								className={`font-semibold ${
									active ? 'text-slate-900' : done_step ? 'text-emerald-700' : 'text-slate-400'
								}`}
							>
								{s.label}
							</span>
							{i < steps.length - 1 ? (
								<ChevronRight className="h-3.5 w-3.5 text-slate-300" />
							) : null}
						</li>
					);
				})}
			</ol>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{/* ── Step: Identity ─────────────────────────────────────── */}
			{step === 'identity' ? (
				<div className="grid gap-8 xl:grid-cols-12">
					<div className="space-y-6 xl:col-span-7">
						<div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							<h2 className="text-sm font-semibold">Identity</h2>
							<p className="mt-1 text-xs text-slate-500">
								Slug is permanent and used in URLs and CLI refs.
							</p>
							<div className="mt-5 grid gap-4 sm:grid-cols-2">
								<label className="block text-xs font-semibold text-slate-600">
									Slug
									<div className="mt-1 flex overflow-hidden rounded-lg border border-slate-200 focus-within:ring-2 focus-within:ring-indigo-500/30">
										<span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-xs text-slate-400">{current_org?.slug ?? 'org'}.</span>
										<input
											value={slug}
											onChange={(e) => set_slug(e.target.value)}
											placeholder="prod-west"
											className="w-full border-0 px-3 py-2.5 font-mono text-sm outline-none"
											autoFocus
										/>
									</div>
								</label>
								<label className="block text-xs font-semibold text-slate-600">
									Display name
									<input
										value={name}
										onChange={(e) => set_name(e.target.value)}
										placeholder="Prod West"
										className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
										onKeyDown={(e) => e.key === 'Enter' && handle_create_realm()}
									/>
								</label>
							</div>
						</div>
						<div className="flex gap-3">
							<button
								type="button"
								onClick={handle_create_realm}
								disabled={creating}
								className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
							>
								{creating ? 'Creating…' : 'Create & continue'}
							</button>
							<button
								type="button"
								onClick={on_cancel}
								className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
							>
								Cancel
							</button>
						</div>
					</div>
					<aside className="xl:col-span-5">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-6 xl:sticky xl:top-4">
							<h2 className="text-sm font-semibold text-slate-800">What happens next</h2>
							<ul className="mt-4 space-y-3 text-sm text-slate-600">
								<li>The realm is created and pre-populated with your current global settings:</li>
								<li className="pl-4 text-xs">• Alert settings (Slack, email, webhook) copied from your account defaults.</li>
								<li className="pl-4 text-xs">• Agent credentials (API keys, endpoints) cloned from your account agent settings.</li>
								<li>You can then add teams, members, and mint a daemon enroll token — all in one flow.</li>
								<li>Everything you configure here is editable later from the realm page.</li>
							</ul>
						</div>
					</aside>
				</div>
			) : null}

			{/* ── Step: Teams ────────────────────────────────────────── */}
			{step === 'teams' ? (
				<div className="grid gap-8 xl:grid-cols-12">
					<div className="space-y-6 xl:col-span-8">
						<div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							<div className="mb-4 flex items-center justify-between gap-3">
								<div>
									<h2 className="text-sm font-semibold">Add teams (optional)</h2>
									<p className="mt-1 text-xs text-slate-500">
										Declared teams appear in the realm's Teams list. Daemons enrolled later will pick them up on install.
									</p>
								</div>
								<span className="text-xs font-semibold text-slate-500">
									{selected_teams.size} selected
								</span>
							</div>
							<input
								value={team_query}
								onChange={(e) => set_team_query(e.target.value)}
								placeholder="Search teams by @scope/slug"
								className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
							/>
							<div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100">
								{team_options_loading ? (
									<p className="p-4 text-sm text-slate-400">Loading teams…</p>
								) : filtered_team_options.length === 0 ? (
									<p className="p-4 text-sm text-slate-400">
										{team_query ? 'No teams match this filter.' : 'No published teams available.'}
									</p>
								) : (
									<ul className="divide-y divide-slate-50">
										{filtered_team_options.map((t) => {
											const checked = selected_teams.has(t.label);
											return (
												<li key={t.label}>
													<label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-slate-50">
														<input
															type="checkbox"
															checked={checked}
															onChange={() => toggle_team(t.label)}
															className="rounded border-slate-300"
														/>
														<span className="font-mono text-xs text-slate-700">{t.label}</span>
													</label>
												</li>
											);
										})}
									</ul>
								)}
							</div>
						</div>
						<div className="flex flex-wrap gap-3">
							<button
								type="button"
								onClick={() => void handle_save_teams(true)}
								disabled={saving_teams}
								className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
							>
								{saving_teams
									? 'Saving…'
									: selected_teams.size > 0
										? `Add ${selected_teams.size} & continue`
										: 'Skip & continue'}
							</button>
							<button
								type="button"
								onClick={() => set_step('members')}
								className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
							>
								Skip
							</button>
						</div>
					</div>
					<aside className="xl:col-span-4">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 xl:sticky xl:top-4">
							<p className="font-semibold text-slate-800">Team list</p>
							<p className="mt-2">
								The team list is the source of truth for coverage. Adding a team here doesn't install it on any daemon — it just declares intent.
							</p>
						</div>
					</aside>
				</div>
			) : null}

			{/* ── Step: Members ──────────────────────────────────────── */}
			{step === 'members' ? (
				<div className="grid gap-8 xl:grid-cols-12">
					<div className="space-y-6 xl:col-span-8">
						<div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							<h2 className="text-sm font-semibold">Add existing users</h2>
							<p className="mt-1 text-xs text-slate-500">
								Search by username or display name; add with a role. Existing users get instant access.
							</p>
							<div className="mt-3 flex flex-wrap gap-2">
								<div className="relative flex-1 min-w-[16rem]">
									<input
										value={member_query}
										onChange={(e) => void search_members(e.target.value)}
										placeholder="Search @handle or name"
										className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
									/>
									{member_results.length > 0 ? (
										<ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
											{member_results.map((u) => (
												<li key={u.id}>
													<button
														type="button"
														onClick={() => void handle_add_member(u)}
														disabled={busy_member}
														className="w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 disabled:opacity-50"
													>
														<span className="font-semibold">@{u.username}</span>
														{u.display_name ? (
															<span className="ml-2 text-slate-500">{u.display_name}</span>
														) : null}
													</button>
												</li>
											))}
										</ul>
									) : null}
									{member_searching ? (
										<span className="absolute right-3 top-2.5 text-xs text-slate-400">Searching…</span>
									) : null}
								</div>
								<select
									value={pending_role}
									onChange={(e) => set_pending_role(e.target.value as Grant_role_option['value'])}
									className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
								>
									{ROLES.map((r) => (
										<option key={r.value} value={r.value}>{r.label}</option>
									))}
								</select>
							</div>

							{added_members.length > 0 ? (
								<div className="mt-4">
									<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
										Added
									</p>
									<ul className="mt-2 space-y-1.5">
										{added_members.map((m) => (
											<li key={m.user.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm">
												<span className="font-semibold">@{m.user.username}</span>
												<span className="text-xs text-slate-500">{m.role}</span>
											</li>
										))}
									</ul>
								</div>
							) : null}
						</div>

						<div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							<h2 className="text-sm font-semibold">Invite by email</h2>
							<p className="mt-1 text-xs text-slate-500">
								Sends a signup+join invite. They land on the realm on accept.
							</p>
							<div className="mt-3 flex flex-wrap gap-2">
								<input
									type="email"
									value={invite_email}
									onChange={(e) => set_invite_email(e.target.value)}
									placeholder="teammate@example.com"
									className="min-w-[16rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
									onKeyDown={(e) => e.key === 'Enter' && handle_send_invite()}
								/>
								<select
									value={invite_role}
									onChange={(e) => set_invite_role(e.target.value as Grant_role_option['value'])}
									className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
								>
									{ROLES.map((r) => (
										<option key={r.value} value={r.value}>{r.label}</option>
									))}
								</select>
								<button
									type="button"
									onClick={() => void handle_send_invite()}
									disabled={busy_member || !invite_email.trim()}
									className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
								>
									Send invite
								</button>
							</div>

							{sent_invites.length > 0 ? (
								<div className="mt-4">
									<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
										Sent
									</p>
									<ul className="mt-2 space-y-1.5">
										{sent_invites.map((inv) => (
											<li key={inv.email} className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
												<span>{inv.email}</span>
												<span className="text-xs">{inv.role}</span>
											</li>
										))}
									</ul>
								</div>
							) : null}
						</div>

						<div className="flex flex-wrap gap-3">
							<button
								type="button"
								onClick={() => set_step('token')}
								className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
							>
								Continue to token
							</button>
							<button
								type="button"
								onClick={() => set_step('token')}
								className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
							>
								Skip
							</button>
						</div>
					</div>
					<aside className="xl:col-span-4">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 xl:sticky xl:top-4">
							<p className="font-semibold text-slate-800">You're admin by default</p>
							<p className="mt-2">
								You already have admin on this realm as the creator. Anyone you add here starts with the role you pick — change roles later from the realm's Members tab.
							</p>
						</div>
					</aside>
				</div>
			) : null}

			{/* ── Step: Token ────────────────────────────────────────── */}
			{step === 'token' ? (
				<div className="grid gap-8 xl:grid-cols-12">
					<div className="space-y-6 xl:col-span-8">
						<div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							<h2 className="text-sm font-semibold">Mint enroll token (optional)</h2>
							<p className="mt-1 text-xs text-slate-500">
								Daemons use this token to join the realm. Shown once — save it somewhere safe or you'll need to mint another.
							</p>
							<label className="mt-4 block text-xs font-semibold text-slate-600">
								Token name
								<input
									value={token_name}
									onChange={(e) => set_token_name(e.target.value)}
									placeholder="default"
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
								/>
							</label>
							{minted_token ? (
								<div className="mt-4">
									<NewTokenBanner
										token={minted_token}
										env_var="CLIQ_DAEMON_TOKEN"
										permissions_summary={
											minted_realm_ids.length > 0 ? (
												<p className="text-xs text-amber-800">
													Realms:{' '}
													{minted_realm_ids.map((id, i) => (
														<span key={id}>
															{i > 0 ? ', ' : null}
															{realm && id === realm.id ? (
																<Link
																	to={`/o/${realm.org_slug ?? 'unknown'}/realms/${realm.slug}`}
																	className="font-semibold underline"
																>
																	{realm.slug}
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
								</div>
							) : (
								<pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-100">
{`export CLIQ_DAEMON_TOKEN=cliq_dt_••••••••
cliq-daemon start`}
								</pre>
							)}
							<div className="mt-4 flex flex-wrap gap-3">
								{!minted_token ? (
									<button
										type="button"
										onClick={() => void handle_mint_token()}
										disabled={minting}
										className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
									>
										{minting ? 'Minting…' : 'Mint token'}
									</button>
								) : (
									<button
										type="button"
										onClick={finish}
										className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
									>
										Finish
									</button>
								)}
								<button
									type="button"
									onClick={finish}
									className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
								>
									{minted_token ? 'Close' : 'Skip & finish'}
								</button>
							</div>
						</div>
					</div>
					<aside className="xl:col-span-4">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 xl:sticky xl:top-4">
							<p className="font-semibold text-slate-800">Daemon vs user tokens</p>
							<p className="mt-2">
								<code className="rounded bg-white px-1 text-xs">cliq_dt_…</code> enrolls a daemon into this realm.{' '}
								<code className="rounded bg-white px-1 text-xs">cliq_pat_…</code> logs a person into Hub. Mint more anytime from the realm's Tokens tab.
							</p>
						</div>
					</aside>
				</div>
			) : null}
		</div>
	);
}
