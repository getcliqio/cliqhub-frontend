/**
 * Settings (Graphite) — your account. /settings?tab=profile|password|tokens|scopes
 *   profile   users/update_profile · your orgs (orgs/leave)
 *   password  users/change_password
 *   tokens    auth/get_tokens · generate_token · rotate_token · revoke_token (type user)
 *   scopes    orgs/get_scopes {user_id: me}
 * Org-wide settings moved: agents → /agents, channels/notifications → /notifications,
 * members/roles/Jira/A2A → Manage › Organization. Old ?tab= values redirect.
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, month_year } from '@/lib/admin';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Avatar, Banner, Empty_row, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { Org_status_pill } from '@/components/graphite/g_invites';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Secret_reveal } from '@/components/graphite/g_secret';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import { ROW_OPENS, use_row_open } from '@/components/graphite/g_row';

type Tab = 'profile' | 'password' | 'tokens' | 'scopes';
const TABS: Array<[Tab, string, string]> = [['profile', 'Profile', 'Account'], ['password', 'Password', 'Account'], ['tokens', 'Access tokens', 'Account'], ['scopes', 'My scopes', 'Publishing']];
/** Where the old /settings tabs went. */
export const LEGACY_SETTINGS_TAB: Record<string, string> = {
	security: '/settings?tab=password',
	access: '/settings?tab=tokens',
	agents: '/agents',
	channels: '/notifications?tab=channels',
	notifications: '/notifications',
	bindings: '/notifications',
	integrations: '/org?tab=integrations',
	mesh: '/org?tab=a2a',
	members: '/org',
	roles: '/org?tab=roles',
	organizations: '/realms',
	accounts: '/realms',
};
const G_DANGER = 'inline-flex items-center whitespace-nowrap rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] disabled:opacity-40';

function Profile() {
	const row = use_row_open();
	const { user, refresh } = useAuth();
	const overview = use_overview();
	const post = use_post();
	const [name, set_name] = useState(user?.display_name ?? '');
	const [email, set_email] = useState(user?.email ?? '');
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [busy, set_busy] = useState(false);
	const [leaving, set_leaving] = useState<string | null>(null);
	if (!user) return null;
	const dirty = name.trim() !== (user.display_name ?? '') || email.trim() !== (user.email ?? '');
	async function save(e: FormEvent) {
		e.preventDefault();
		if (!name.trim()) { set_msg({ tone: 'bad', text: 'Display name is required.' }); return; }
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { set_msg({ tone: 'bad', text: 'Enter a valid email.' }); return; }
		const body: Record<string, string> = {};
		if (name.trim() !== user!.display_name) body.display_name = name.trim();
		if (email.trim() !== user!.email) body.email = email.trim();
		set_busy(true); set_msg(null);
		const r = await post('/v1/users/update_profile', body);
		set_busy(false);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		set_msg({ tone: 'ok', text: 'Profile saved.' });
		await refresh();
	}
	async function leave(org_id: string, label: string) {
		set_busy(true);
		const r = await post('/v1/orgs/leave', { org_id });
		set_busy(false); set_leaving(null);
		set_msg(r.ok ? { tone: 'ok', text: `You left ${label}.` } : { tone: 'bad', text: r.error });
		if (r.ok) await overview.reload?.();
	}
	const orgs = overview.data?.orgs ?? [];
	return (
		<div className="flex max-w-[640px] flex-col gap-4">
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			<form onSubmit={(e) => void save(e)} className="flex flex-col gap-3.5 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-5" aria-label="Profile">
				<div className="flex items-center gap-3.5"><Avatar name={user.display_name || user.username} size={48} /><div><b className="text-[16px]">{user.display_name || user.username}</b><div className="text-[12.5px] text-[var(--g-ink-3)]">@{user.username}{user.role === 'admin' ? ' · site admin' : ''}</div></div></div>
				<label className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">Display name<input aria-label="Display name" value={name} onChange={(e) => set_name(e.target.value)} className={`${G_INPUT} w-full`} /></label>
				<label className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">Email<input aria-label="Email" type="email" value={email} onChange={(e) => set_email(e.target.value)} className={`${G_INPUT} w-full`} /><span className="text-[11.5px] text-[var(--g-ink-3)]">Used for invites and notifications.</span></label>
				<label className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">Username<input aria-label="Username" value={user.username} readOnly className={`${G_INPUT} w-full opacity-70`} /><span className="text-[11.5px] text-[var(--g-ink-3)]">Can’t be changed — it’s your personal scope @{user.username}.</span></label>
				<div><button type="submit" disabled={busy || !dirty} className={G_PRIMARY}>Save</button></div>
			</form>
			<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-5" aria-label="Organizations">
				<b className="text-[14px]">Organizations</b>
				<ul className="mt-3 flex flex-col gap-2.5">
					{orgs.map((o) => {
						const manager = o.role === 'owner' || o.role === 'admin';
						return (
							<li key={o.id} {...row({ to: manager ? `/orgs/${o.id}` : null })} className={`flex items-center gap-2.5 rounded-md px-1 ${manager ? ROW_OPENS : ''}`} data-testid={`my-org-${o.slug}`}>
								<Avatar name={o.display_name || o.slug} size={24} />
								<span>{o.display_name || o.slug}</span><span className="text-[12.5px] text-[var(--g-ink-3)]">{o.role}</span>{o.org_status !== 'active' ? <Org_status_pill status={o.org_status} /> : null}
								<span className="ml-auto flex gap-2">
									{manager ? <Link to={`/orgs/${o.id}`} className={G_BTN}>Manage</Link> : null}
									{o.slug !== user.username ? (leaving === o.id
										? <><button type="button" disabled={busy} onClick={() => void leave(o.id, o.display_name || o.slug)} className={G_DANGER}>Leave {o.display_name || o.slug}</button><button type="button" onClick={() => set_leaving(null)} className={G_BTN}>Cancel</button></>
										: <button type="button" onClick={() => set_leaving(o.id)} className={G_BTN}>Leave…</button>) : null}
								</span>
							</li>
						);
					})}
					{!orgs.length ? <li className="text-[12.5px] text-[var(--g-ink-3)]">Not in any organization.</li> : null}
				</ul>
			</section>
		</div>
	);
}

function Password() {
	const post = use_post();
	const [f, set_f] = useState({ cur: '', next: '', again: '' });
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [busy, set_busy] = useState(false);
	const mismatch = f.again.length > 0 && f.next !== f.again;
	async function save(e: FormEvent) {
		e.preventDefault();
		set_busy(true); set_msg(null);
		const r = await post('/v1/users/change_password', { current_password: f.cur, new_password: f.next });
		set_busy(false);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		set_f({ cur: '', next: '', again: '' });
		set_msg({ tone: 'ok', text: 'Password changed.' });
	}
	return (
		<form onSubmit={(e) => void save(e)} className="flex max-w-[480px] flex-col gap-3.5 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-5" aria-label="Change password">
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			{([['cur', 'Current password', 'current-password'], ['next', 'New password (8+ characters)', 'new-password'], ['again', 'Confirm new password', 'new-password']] as const).map(([k, l, ac]) => (
				<label key={k} className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">{l}<input aria-label={l} type="password" autoComplete={ac} value={f[k]} onChange={(e) => set_f({ ...f, [k]: e.target.value })} className={`${G_INPUT} w-full ${k === 'again' && mismatch ? 'border-[var(--g-bad-line)]' : ''}`} /></label>
			))}
			{mismatch ? <p className="text-[12px] text-[var(--g-bad)]">Passwords don’t match.</p> : null}
			<div><button type="submit" disabled={busy || !f.cur || f.next.length < 8 || f.next !== f.again} className={G_PRIMARY}>Change password</button></div>
		</form>
	);
}

interface Token_row { id: string; name: string; permissions?: { domains?: { orgs?: string[] | '*' } }; created_at: string; last_used_at: string | null }

function freshness(t: Token_row) {
	if (!t.last_used_at) return <Pill tone="muted">unused</Pill>;
	const days = (Date.now() - Date.parse(t.last_used_at)) / 864e5;
	return days > 90 ? <Pill tone="warn">stale · {Math.round(days)}d</Pill> : <Pill tone="ok">{ago(t.last_used_at)} ago</Pill>;
}

function Tokens() {
	const overview = use_overview();
	const post = use_post();
	const read = use_bff_read<{ tokens: Token_row[]; total?: number }>('/v1/auth/get_tokens', { type: 'user', limit: 100, offset: 0 }, { fallback_error: 'Could not load tokens.' });
	const [creating, set_creating] = useState(false);
	const [name, set_name] = useState('');
	const [orgs_sel, set_orgs_sel] = useState<string[]>([]);
	const [secret, set_secret] = useState<{ title: string; value: string } | null>(null);
	const [confirm, set_confirm] = useState<{ id: string; action: 'rotate' | 'revoke' } | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [busy, set_busy] = useState(false);
	const orgs = overview.data?.orgs ?? [];
	const org_label = (id: string) => { const o = orgs.find((x) => x.id === id); return o ? o.display_name || o.slug : id.slice(0, 8); };
	const works_in = (t: Token_row) => { const ids = t.permissions?.domains?.orgs; return !ids || ids === '*' || !ids.length ? 'All my orgs' : ids.map(org_label).join(', '); };
	async function create(e: FormEvent) {
		e.preventDefault();
		set_busy(true); set_msg(null);
		const r = await post('/v1/auth/generate_token', { type: 'user', name: name.trim(), ...(orgs_sel.length ? { permissions: { domains: { orgs: orgs_sel } } } : {}) });
		set_busy(false);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		set_secret({ title: `${name.trim()} created`, value: String((r.data as { token?: string }).token ?? '') });
		set_creating(false); set_name(''); set_orgs_sel([]);
		void read.reload();
	}
	async function act(t: Token_row, action: 'rotate' | 'revoke') {
		set_busy(true); set_msg(null);
		const r = await post(`/v1/auth/${action}_token`, { type: 'user', token_id: t.id });
		set_busy(false); set_confirm(null);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		if (action === 'rotate') set_secret({ title: `${t.name} rotated`, value: String((r.data as { token?: string }).token ?? '') });
		else set_msg({ tone: 'ok', text: `${t.name} revoked — anything using it stops working now.` });
		void read.reload();
	}
	// All of the caller's tokens are loaded (one page of 100), so sorting here is exact for any real account.
	const tsort = use_table_sort({ keys: ['name', 'works_in', 'created_at', 'last_used_at'], mode: 'client', param: 'tokens', first_dir: { created_at: 'desc', last_used_at: 'desc' } });
	const tokens = sort_rows(read.data?.tokens ?? [], tsort, {
		name: (t) => t.name, works_in: (t) => works_in(t), created_at: (t) => Date.parse(t.created_at) || null,
		last_used_at: (t) => (t.last_used_at ? Date.parse(t.last_used_at) : null),
	});
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<p className="max-w-[640px] text-[12.5px] text-[var(--g-ink-3)]">For the <span className="g-mono">cliq</span> CLI and scripts — they act as you. Daemons use realm tokens instead (Realm › Settings › Tokens).</p>
				<button type="button" onClick={() => { set_creating(true); set_secret(null); }} className={`${G_PRIMARY} ml-auto`}><Plus className="h-3.5 w-3.5" /> New token</button>
			</div>
			{secret ? <Secret_reveal title={secret.title} secret={secret.value} env_name="CLIQ_TOKEN" on_done={() => set_secret(null)} /> : null}
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			{creating ? (
				<form onSubmit={(e) => void create(e)} aria-label="New token" className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
					<label className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">Name<input aria-label="Token name" value={name} onChange={(e) => set_name(e.target.value)} placeholder="laptop-cli" className={`${G_INPUT} w-[280px]`} /></label>
					<div className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">Works in
						<div className="flex flex-wrap gap-2">{orgs.map((o) => <label key={o.id} className="flex items-center gap-1.5 rounded-full border border-[var(--g-line)] px-3 py-1"><input type="checkbox" checked={orgs_sel.includes(o.id)} onChange={(e) => set_orgs_sel((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))} />{o.display_name || o.slug}</label>)}</div>
						<span className="text-[11.5px] text-[var(--g-ink-3)]">{orgs_sel.length ? 'Only in the orgs you picked.' : 'Nothing picked = every org you belong to.'}</span>
					</div>
					<div className="flex gap-2"><button type="submit" disabled={busy || !name.trim()} className={G_PRIMARY}>Create token</button><button type="button" onClick={() => set_creating(false)} className={G_BTN}>Cancel</button></div>
				</form>
			) : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={tsort} k="name" className={TH}>Name</Sort_th><Sort_th sort={tsort} k="works_in" className={TH}>Works in</Sort_th><Sort_th sort={tsort} k="created_at" className={TH}>Created</Sort_th><Sort_th sort={tsort} k="last_used_at" className={TH}>Last used</Sort_th><th className={TH} /></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={5}>Loading…</Empty_row> : null}
						{read.data && !tokens.length ? <Empty_row cols={5}>No access tokens yet.</Empty_row> : null}
						{tokens.map((t) => (
							<tr key={t.id} className={TR} data-testid={`token-${t.name}`}>
								<td className="g-mono px-4 py-2.5">{t.name}</td>
								<td className="px-4 text-[var(--g-ink-2)]">{works_in(t)}</td>
								<td className="px-4 text-[var(--g-ink-3)]">{month_year(t.created_at)}</td>
								<td className="px-4">{freshness(t)}</td>
								<td className="px-4 text-right">
									{confirm?.id === t.id ? (
										<span className="inline-flex items-center gap-2 text-[12px]">
											<span className="text-[var(--g-ink-3)]">{confirm.action === 'revoke' ? 'Anything using it stops working.' : 'The old value stops working.'}</span>
											<button type="button" disabled={busy} onClick={() => void act(t, confirm.action)} className={confirm.action === 'revoke' ? G_DANGER : G_PRIMARY}>{confirm.action === 'revoke' ? 'Revoke' : 'Rotate'}</button>
											<button type="button" onClick={() => set_confirm(null)} className={G_BTN}>Cancel</button>
										</span>
									) : (
										<span className="inline-flex gap-2"><button type="button" onClick={() => set_confirm({ id: t.id, action: 'rotate' })} className={G_BTN}>Rotate…</button><button type="button" onClick={() => set_confirm({ id: t.id, action: 'revoke' })} className={G_DANGER}>Revoke…</button></span>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

interface Scope_row { id: string; slug: string; display_name?: string; visibility?: string; scope_type?: string; team_count?: number | string; org_id?: string | null }

function Scopes() {
	const row = use_row_open();
	const { user } = useAuth();
	// orgs/get_scopes answers PagedData (`items`); `scopes` is kept for older BFFs.
	const read = use_bff_read<{ items?: Scope_row[]; scopes?: Scope_row[] }>('/v1/orgs/get_scopes', user ? { user_id: user.id, limit: 100 } : null, { fallback_error: 'Could not load your scopes.' });
	const ssort = use_table_sort({ keys: ['slug', 'type', 'visibility', 'teams'], mode: 'client', param: 'scopes', first_dir: { teams: 'desc' } });
	const rows = sort_rows(read.data?.items ?? read.data?.scopes ?? [], ssort, {
		slug: (s) => s.slug, type: (s) => (s.scope_type === 'user' || !s.org_id ? 'personal' : 'org'),
		visibility: (s) => s.visibility ?? 'private', teams: (s) => Number(s.team_count ?? 0),
	});
	return (
		<div className="flex flex-col gap-3">
			<p className="text-[12.5px] text-[var(--g-ink-3)]">Namespaces you can publish teams under (<span className="g-mono">@scope/team</span>). Org scopes are managed in Manage › Organization › Scopes.</p>
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={ssort} k="slug" className={TH}>Scope</Sort_th><Sort_th sort={ssort} k="type" className={TH}>Type</Sort_th><Sort_th sort={ssort} k="visibility" className={TH}>Visibility</Sort_th><Sort_th sort={ssort} k="teams" className={TH}>Teams</Sort_th><th className={TH} /></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={5}>Loading…</Empty_row> : null}
						{read.data && !rows.length ? <Empty_row cols={5}>No scopes.</Empty_row> : null}
						{rows.map((s) => (
							<tr key={s.id} {...row({ to: `/browse/s/${encodeURIComponent(s.slug)}` })} className={`${TR} ${ROW_OPENS}`}>
								<td className="g-mono px-4 py-2.5"><Link to={`/browse/s/${encodeURIComponent(s.slug)}`} className="hover:underline">@{s.slug}</Link></td>
								<td className="px-4 text-[var(--g-ink-3)]">{s.scope_type === 'user' || !s.org_id ? 'personal' : 'org'}</td>
								<td className="px-4"><Pill tone={s.visibility === 'public' ? 'ok' : 'muted'}>{s.visibility ?? 'private'}</Pill></td>
								<td className="g-mono px-4">{Number(s.team_count ?? 0)}</td>
								<td className="px-4 text-right"><Link to={`/browse/s/${encodeURIComponent(s.slug)}`} className="text-[12.5px] text-[var(--g-acc)]">View →</Link></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export function Component() {
	const overview = use_overview();
	const [sp, set_sp] = useSearchParams();
	const raw = sp.get('tab') ?? 'profile';
	if (LEGACY_SETTINGS_TAB[raw]) return <Navigate to={LEGACY_SETTINGS_TAB[raw]} replace />;
	const tab = (TABS.some(([k]) => k === raw) ? raw : 'profile') as Tab;
	const groups = [...new Set(TABS.map((t) => t[2]))];
	return (
		<Graphite_shell data={overview.data} title="Settings">
			<div className="flex flex-col gap-4 px-7 py-6">
				<div><h1 className="text-[22px] font-semibold tracking-tight">Settings</h1><p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Your account. Org-wide settings live under Manage › Organization.</p></div>
				<div className="flex flex-col gap-6 md:flex-row">
					<nav aria-label="Settings" className="flex w-full shrink-0 flex-col gap-0.5 md:w-[200px]">
						{groups.map((g) => (
							<div key={g}>
								<div className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{g}</div>
								{TABS.filter((t) => t[2] === g).map(([k, l]) => (
									<button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => set_sp(k === 'profile' ? {} : { tab: k }, { replace: true })} className={`block w-full rounded-lg px-2.5 py-[7px] text-left text-[13px] ${tab === k ? 'bg-[var(--g-hover)] text-white shadow-[inset_2px_0_0_var(--g-acc)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]'}`}>{l}</button>
								))}
							</div>
						))}
					</nav>
					<div className="min-w-0 flex-1">
						{tab === 'profile' ? <Profile /> : tab === 'password' ? <Password /> : tab === 'tokens' ? <Tokens /> : <Scopes />}
					</div>
				</div>
			</div>
		</Graphite_shell>
	);
}
