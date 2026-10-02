/**
 * Realm › Settings (Graphite). Read: one `POST /v1/realm_settings/get`
 * (BFF: realm, members, pending invites, access tokens). Every write is one
 * existing route: realms/update, realms/add_member (also changes a role),
 * realms/remove_member, invitations/create, invitations/revoke, auth/generate_token,
 * auth/revoke_token, realms/delete. Agents and Notifications live in Manage.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowUpRight, Check, Copy, Lock, RefreshCw } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview, relative_time } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { realm_path } from '@/lib/realm_url';
import { Realm_a2a_panel } from '@/components/graphite/g_mesh';
import { handle, person_name } from '@/lib/admin';
import { REALM_ROLES, type Realm_settings_data, type Settings_section } from '@/lib/realm_settings';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import { use_invite } from '@/components/graphite/g_invites';

const INPUT = 'h-9 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
const PRIMARY = 'rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';
const CARD = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';

type Post = (path: string, body: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

function use_post(): Post {
	const auth_fetch = useAuthFetch();
	return async (path, body) => {
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) return { ok: false, error: api_message(payload, 'Request failed') };
			return { ok: true, data: payload.data ?? payload };
		} catch {
			return { ok: false, error: 'Network error — check your connection.' };
		}
	};
}

function Msg({ msg }: { msg: { tone: 'ok' | 'bad'; text: string } | null }) {
	return msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null;
}

function Read_only_note() {
	return <p className="flex items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]" data-testid="read-only"><Lock aria-hidden className="h-3.5 w-3.5" />View only — realm admins and org owners/admins can change this.</p>;
}

/* ------------------------------------------------------------------ */

function General({ data, admin, post, reload }: { data: Realm_settings_data; admin: boolean; post: Post; reload: () => Promise<void> }) {
	const [name, set_name] = useState(data.realm.name);
	const [busy, set_busy] = useState(false);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	async function save() {
		set_busy(true); set_msg(null);
		const res = await post('/v1/realms/update', { realm_id: data.realm.id, name: name.trim() });
		set_busy(false);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: 'Saved.' });
		await reload();
	}
	return (
		<div className="flex max-w-[560px] flex-col gap-4">
			<div><h2 className="text-[16px] font-semibold">General</h2><p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">How this realm is shown across CliqHub.</p></div>
			<label className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-3)]">Display name
				<input aria-label="Display name" value={name} disabled={!admin} onChange={(e) => set_name(e.target.value)} className={`${INPUT} w-full disabled:opacity-60`} />
			</label>
			<dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[12.5px]">
				<dt className="text-[var(--g-ink-3)]">Slug</dt><dd className="g-mono">{data.realm.slug}</dd>
				<dt className="text-[var(--g-ink-3)]">Org</dt><dd className="g-mono">{data.realm.org_slug ?? '—'}</dd>
				<dt className="text-[var(--g-ink-3)]">Realm id</dt><dd className="g-mono text-[var(--g-ink-3)]">{data.realm.id}</dd>
			</dl>
			<Msg msg={msg} />
			{admin ? <div><button type="button" disabled={busy || !name.trim() || name.trim() === data.realm.name} onClick={() => void save()} className={PRIMARY}>{busy ? 'Saving…' : 'Save'}</button></div> : <Read_only_note />}
		</div>
	);
}

/* ------------------------------------------------------------------ */

function Add_member({ realm_id, post, on_added }: { realm_id: string; post: Post; on_added: () => Promise<void> }) {
	const auth_fetch = useAuthFetch();
	const [q, set_q] = useState('');
	const [results, set_results] = useState<Array<{ id: string; username: string | null; display_name: string; email: string }>>([]);
	const [picked, set_picked] = useState<{ id: string; label: string } | null>(null);
	const [role, set_role] = useState('operator');
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const seq = useRef(0);
	useEffect(() => {
		const term = q.trim().replace(/^@+/, '');
		if (term.length < 2 || picked) { set_results([]); return; }
		const my = ++seq.current;
		const t = setTimeout(async () => {
			try {
				const res = await auth_fetch('/v1/users/get', { method: 'POST', body: JSON.stringify({ realm_id, query: term }) });
				const data = await res.json().catch(() => null);
				if (my === seq.current) set_results(data?.ok ? (data.data?.users ?? []) : []);
			} catch { if (my === seq.current) set_results([]); }
		}, 250);
		return () => clearTimeout(t);
	}, [q, picked, realm_id, auth_fetch]);
	async function add() {
		if (!picked) return;
		set_msg(null);
		const res = await post('/v1/realms/add_member', { realm_id, member_type: 'user', member_id: picked.id, role });
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: `${picked.label} added as ${role}.` });
		set_picked(null); set_q('');
		await on_added();
	}
	// No account yet: invite by email (they join the realm when they accept).
	const email = q.trim();
	const can_invite = !picked && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	const invite = use_invite({ target_type: 'realm', realm_id }, async () => { set_q(''); await on_added(); });
	return (
		<div className={`${CARD} flex flex-col gap-2 p-3`} aria-label="Add member" role="group">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-[240px] flex-1">
					<input aria-label="Find a person" value={picked ? picked.label : q} onChange={(e) => { set_picked(null); set_q(e.target.value); }} placeholder="Name, username or email…" className={`${INPUT} w-full`} />
					{results.length && !picked ? (
						<ul role="listbox" aria-label="People" className="absolute left-0 right-0 top-10 z-40 max-h-[220px] overflow-y-auto rounded-lg border border-[#33363c] bg-[#16171a] py-1 shadow-[0_16px_40px_rgba(0,0,0,.55)]">
							{results.map((u) => (
								<li key={u.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); set_picked({ id: u.id, label: person_name(u) }); set_results([]); }} className="cursor-pointer px-3 py-1.5 text-[13px] hover:bg-[var(--g-soft)]">
									{person_name(u)} <span className="text-[var(--g-ink-3)]">{handle(u.username)} · {u.email}</span>
								</li>
							))}
						</ul>
					) : null}
				</div>
				<select aria-label="Role for new member" value={role} onChange={(e) => set_role(e.target.value)} className={`${INPUT} w-[140px]`}>
					{REALM_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
				</select>
				<button type="button" disabled={!picked} onClick={() => void add()} className={PRIMARY}>Add member</button>
				{can_invite ? <button type="button" disabled={invite.busy} onClick={() => { set_msg(null); void invite.send(email, role); }} className="rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-ink)] hover:bg-[var(--g-soft)] disabled:opacity-50" title="They join the realm when they accept">Invite by email</button> : null}
			</div>
			<Msg msg={msg} />
			{invite.view}
		</div>
	);
}

function Members({ data, admin, post, reload }: { data: Realm_settings_data; admin: boolean; post: Post; reload: () => Promise<void> }) {
	const [confirm, set_confirm] = useState<string | null>(null);
	// Every member of the realm is loaded, so sorting here is exact.
	const msort = use_table_sort({ keys: ['member', 'role'], mode: 'client', param: 'members' });
	const members = sort_rows(data.members, msort, { member: (m) => m.username ?? m.member_id, role: (m) => m.role });
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	async function run(path: string, body: Record<string, unknown>, done: string) {
		set_msg(null);
		const res = await post(path, body);
		set_confirm(null);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: done });
		await reload();
	}
	return (
		<div className="flex flex-col gap-4">
			<div><h2 className="text-[16px] font-semibold">Members</h2><p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">People and service accounts in {data.realm.slug}. Org owners and admins can always manage this realm.</p></div>
			{admin ? <Add_member realm_id={data.realm.id} post={post} on_added={reload} /> : <Read_only_note />}
			<Msg msg={msg} />
			{data.sections.members.status === 'error' ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{data.sections.members.error}</p> : null}
			<div className={`${CARD} overflow-hidden`}>
				<table className="w-full text-left text-[12.5px]">
					<thead><tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={msort} k="member" className="px-4 py-2.5 font-semibold">Member</Sort_th><Sort_th sort={msort} k="role" className="px-4 py-2.5 font-semibold">Realm role</Sort_th><th className="w-[160px] px-4 py-2.5" /></tr></thead>
					<tbody>
						{members.map((m) => {
							const key = `${m.member_type}:${m.member_id}`;
							return (
								<tr key={key} className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`member-${m.member_id}`}>
									<td className="px-4 py-2.5"><b className="font-semibold">{m.username ?? m.member_id}</b>{m.is_you ? <span className="ml-2 rounded bg-[var(--g-soft)] px-1.5 text-[11px] text-[var(--g-ink-3)]">you</span> : null}{m.member_type !== 'user' ? <span className="ml-2 rounded bg-[var(--g-soft)] px-1.5 text-[11px] text-[var(--g-ink-3)]">{m.member_type}</span> : null}</td>
									<td className="px-4 py-2.5">
										{admin && !m.is_you ? (
											<select aria-label={`Role for ${m.username ?? m.member_id}`} value={m.role} onChange={(e) => void run('/v1/realms/add_member', { realm_id: data.realm.id, member_type: m.member_type, member_id: m.member_id, role: e.target.value }, `${m.username ?? m.member_id} is now ${e.target.value}.`)} className={`${INPUT} h-8 w-[140px]`}>
												{REALM_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
											</select>
										) : <span className="capitalize">{m.role}</span>}
									</td>
									<td className="px-4 py-2.5 text-right">
										{!admin || m.is_you ? null : confirm === key ? (
											<span className="inline-flex gap-1.5">
												<button type="button" onClick={() => void run('/v1/realms/remove_member', { realm_id: data.realm.id, member_type: m.member_type, member_id: m.member_id }, `${m.username ?? m.member_id} removed.`)} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[#160606]">Remove</button>
												<button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Keep</button>
											</span>
										) : <button type="button" aria-label={`Remove ${m.username ?? m.member_id}`} onClick={() => set_confirm(key)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Remove…</button>}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="text-[12px] text-[var(--g-ink-3)]">{REALM_ROLES.map((r) => `${r.label}: ${r.hint}`).join(' · ')}</p>
			{data.invites.length ? (
				<div className="flex flex-col gap-2">
					<h3 className="text-[13px] font-semibold">Pending invites</h3>
					<ul className={`${CARD} divide-y divide-[var(--g-line-2)]`}>
						{data.invites.map((i) => (
							<li key={i.invite_id} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
								<span className="flex-1">{i.email} <span className="text-[var(--g-ink-3)]">· {i.role}{i.expires_at ? ` · expires ${new Date(i.expires_at).toLocaleDateString()}` : ''}</span></span>
								{admin ? <button type="button" onClick={() => void run('/v1/invitations/revoke', { invite_id: i.invite_id }, `Invite to ${i.email} revoked.`)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Revoke</button> : null}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}

/* ------------------------------------------------------------------ */

function Tokens({ data, admin, post, reload }: { data: Realm_settings_data; admin: boolean; post: Post; reload: () => Promise<void> }) {
	const [name, set_name] = useState('');
	const tsort = use_table_sort({ keys: ['name', 'created_at', 'last_used_at'], mode: 'client', param: 'tokens', first_dir: { created_at: 'desc', last_used_at: 'desc' } });
	const tokens = sort_rows(data.tokens, tsort, { name: (t) => t.name, created_at: (t) => Date.parse(t.created_at) || null, last_used_at: (t) => (t.last_used_at ? Date.parse(t.last_used_at) : null) });
	const [created, set_created] = useState<string | null>(null);
	const [copied, set_copied] = useState(false);
	const [confirm, set_confirm] = useState<string | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	async function create() {
		set_msg(null); set_created(null);
		const res = await post('/v1/auth/generate_token', { type: 'realm', realm_ids: [data.realm.id], name: name.trim() });
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		const d = res.data as { token?: string };
		set_created(d.token ?? null);
		set_name('');
		await reload();
	}
	async function revoke(id: string) {
		set_msg(null);
		const res = await post('/v1/auth/revoke_token', { type: 'realm', realm_id: data.realm.id, token_id: id });
		set_confirm(null);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: 'Token revoked. Daemons using it stop connecting.' });
		await reload();
	}
	return (
		<div className="flex flex-col gap-4">
			<div><h2 className="text-[16px] font-semibold">Access tokens</h2><p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">Daemon tokens enroll servers into {data.realm.slug} without a personal login: set <code className="g-mono">CLIQ_DAEMON_TOKEN</code> and start <code className="g-mono">cliqd</code>.</p></div>
			{admin ? (
				<div className="flex flex-wrap items-center gap-2">
					<input aria-label="Token name" value={name} onChange={(e) => set_name(e.target.value)} placeholder="e.g. ci-runners" className={`${INPUT} w-[240px]`} />
					<button type="button" disabled={!name.trim()} onClick={() => void create()} className={PRIMARY}>Create token</button>
				</div>
			) : <Read_only_note />}
			{created ? (
				<div className={`${CARD} flex flex-col gap-2 border-[var(--g-acc-line)] p-3`} role="status" aria-label="New token">
					<p className="text-[12.5px]"><b>Copy it now</b> — it won’t be shown again.</p>
					<div className="flex items-center gap-2">
						<code className="g-mono flex-1 truncate rounded bg-[#0e0f11] px-2.5 py-2 text-[12px]" data-testid="new-token">{created}</code>
						<button type="button" onClick={() => { void navigator.clipboard?.writeText(created).then(() => set_copied(true)).catch(() => {}); }} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1`}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
					</div>
				</div>
			) : null}
			<Msg msg={msg} />
			{data.sections.tokens.status === 'error' ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{data.sections.tokens.error}</p> : null}
			<div className={`${CARD} overflow-hidden`}>
				{data.tokens.length === 0 ? <p className="px-4 py-8 text-center text-[12.5px] text-[var(--g-ink-3)]">No tokens for this realm.</p> : (
					<table className="w-full text-left text-[12.5px]">
						<thead><tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={tsort} k="name" className="px-4 py-2.5 font-semibold">Name</Sort_th><Sort_th sort={tsort} k="created_at" className="px-4 py-2.5 font-semibold">Created</Sort_th><Sort_th sort={tsort} k="last_used_at" className="px-4 py-2.5 font-semibold">Last used</Sort_th><th className="w-[160px] px-4 py-2.5" /></tr></thead>
						<tbody>
							{tokens.map((t) => (
								<tr key={t.id} className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`token-${t.id}`}>
									<td className="px-4 py-2.5 font-semibold">{t.name}</td>
									<td className="px-4 py-2.5 text-[var(--g-ink-2)]">{relative_time(Date.parse(t.created_at))}</td>
									<td className="px-4 py-2.5 text-[var(--g-ink-2)]">{t.last_used_at ? relative_time(Date.parse(t.last_used_at)) : 'never'}</td>
									<td className="px-4 py-2.5 text-right">
										{!admin ? null : confirm === t.id ? (
											<span className="inline-flex gap-1.5">
												<button type="button" onClick={() => void revoke(t.id)} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[#160606]">Revoke</button>
												<button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Keep</button>
											</span>
										) : <button type="button" aria-label={`Revoke ${t.name}`} onClick={() => set_confirm(t.id)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Revoke…</button>}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */

function Danger({ data, admin, post }: { data: Realm_settings_data; admin: boolean; post: Post }) {
	const navigate = useNavigate();
	const [typed, set_typed] = useState('');
	const [busy, set_busy] = useState(false);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	async function del() {
		set_busy(true); set_msg(null);
		const res = await post('/v1/realms/delete', { realm_id: data.realm.id });
		set_busy(false);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		navigate('/home', { replace: true });
	}
	return (
		<div className="flex max-w-[600px] flex-col gap-4">
			<div><h2 className="text-[16px] font-semibold text-[var(--g-bad)]">Danger zone</h2></div>
			<div className="rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] p-4">
				<b className="text-[13.5px]">Delete this realm</b>
				<p className="mt-1 text-[12.5px] text-[var(--g-ink-2)]">Deletes {data.realm.slug} for everyone in it. Only do this when no team, daemon or person still depends on it.</p>
				{admin ? (
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<input aria-label="Type the realm slug to confirm" value={typed} onChange={(e) => set_typed(e.target.value)} placeholder={data.realm.slug} className={`${INPUT} w-[220px]`} />
						<button type="button" disabled={typed !== data.realm.slug || busy} onClick={() => void del()} className="rounded-md bg-[var(--g-bad)] px-3 py-1.5 text-[12.5px] font-semibold text-[#160606] disabled:opacity-40">{busy ? 'Deleting…' : 'Delete realm'}</button>
					</div>
				) : <div className="mt-3"><Read_only_note /></div>}
				<div className="mt-2"><Msg msg={msg} /></div>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */

const SECTIONS: Array<{ id: Settings_section; label: string }> = [
	{ id: 'general', label: 'General' },
	{ id: 'members', label: 'Members' },
	{ id: 'tokens', label: 'Access tokens' },
	{ id: 'a2a', label: 'A2A & mesh' },
];

export function Component() {
	const { org = '', slug = '' } = useParams();
	const overview = use_overview();
	const post = use_post();
	const [search, set_search] = useSearchParams();
	const raw = search.get('section');
	const section: Settings_section = raw === 'general' || raw === 'tokens' || raw === 'a2a' || raw === 'danger' ? raw : 'members';
	const read = use_bff_read<Realm_settings_data>('/v1/realm_settings/get', org && slug ? { org_slug: org, slug } : null, { fallback_error: 'Could not load settings.' });
	const data = read.data;
	const realm_id = data?.realm.id ?? null;
	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm_id) ?? null;
	const org_role = overview.data?.orgs.find((o) => o.slug === org)?.role ?? null;
	// Realm admins, org owners/admins and site admins can change settings (Core enforces on write).
	const admin = Boolean(data?.you.is_admin || org_role === 'owner' || org_role === 'admin');
	const base = realm_path(org, slug);
	const go = (s: Settings_section) => set_search((prev) => { const p = new URLSearchParams(prev); if (s === 'members') p.delete('section'); else p.set('section', s); return p; }, { replace: true });
	const link = (on: boolean) => `flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[13px] ${on ? 'bg-[var(--g-hover)] text-[var(--g-ink)] shadow-[inset_2px_0_0_var(--g-acc)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]'}`;
	const head = 'px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]';

	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_id}
			title="Settings"
			actions={<button type="button" onClick={() => void read.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><RefreshCw className="h-3.5 w-3.5" /></button>}
		>
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm} />
			<div className="px-7 py-6">
				{read.status === 'loading' ? <div className="h-[360px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading settings" /> : null}
				{read.status === 'error' && !data ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="realm" /> : null}
				{data ? (
					<div className="flex gap-6">
						<nav aria-label="Settings sections" className="flex w-[210px] shrink-0 flex-col gap-0.5">
							<div className={head}>Realm</div>
							{SECTIONS.map((s) => (
								<button key={s.id} type="button" aria-current={section === s.id ? 'page' : undefined} onClick={() => go(s.id)} className={link(section === s.id)}>
									{s.label}
									{s.id === 'members' ? <span className="g-mono ml-auto text-[11px] text-[var(--g-ink-3)]">{data.members.length}</span> : null}
								</button>
							))}
							<div className={head}>Set up in Manage</div>
							<Link to={`${base}/agents`} className={link(false)}>Agents</Link>
							<Link to={`/notifications?org=${encodeURIComponent(org)}`} className={link(false)}>Notifications <ArrowUpRight aria-hidden className="ml-auto h-3 w-3 opacity-60" /></Link>
							<div className="mt-3" />
							<button type="button" aria-current={section === 'danger' ? 'page' : undefined} onClick={() => go('danger')} className={`flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[13px] text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] ${section === 'danger' ? 'bg-[var(--g-bad-soft)] shadow-[inset_2px_0_0_var(--g-bad)]' : ''}`}>Danger zone</button>
						</nav>
						<div className="min-w-0 flex-1">
							{section === 'general' ? <General data={data} admin={admin} post={post} reload={read.reload} /> : null}
							{section === 'members' ? <Members data={data} admin={admin} post={post} reload={read.reload} /> : null}
							{section === 'tokens' ? <Tokens data={data} admin={admin} post={post} reload={read.reload} /> : null}
							{section === 'a2a' ? <Realm_a2a_panel realm_id={data.realm.id} can_edit={admin} /> : null}
							{section === 'danger' ? <Danger data={data} admin={admin} post={post} /> : null}
						</div>
					</div>
				) : null}
			</div>
		</Graphite_shell>
	);
}
