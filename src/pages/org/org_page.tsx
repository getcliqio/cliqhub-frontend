/**
 * Manage › Organization (Graphite) — /orgs/:id?tab=members|roles|scopes|integrations|a2a|settings
 * For a customer org's owners/admins (members see a read-only view).
 * Read: `POST /v1/org_page/get` (org with member statuses + pending invites + permission catalogue).
 * The header shows a Waiting-for-owner banner (who, when the invite expires) until the owner accepts.
 * Writes (existing Core routes):
 *   members   invitations/create (invite, send again) · invitations/revoke · users/update_role · orgs/update (make owner) · orgs/remove_member
 *   roles     orgs/create_role · update_role · delete_role
 *   scopes    orgs/new_scope · delete_scope · assign_scope_member · unassign_scope_member
 *   jira      integrations/jira/get_workspaces · rotate_secret · disconnect_workspace
 *   a2a       orgs/mesh/get|update (Org_mesh_panel)
 *   settings  orgs/update · orgs/leave
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Lock, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, handle, login_name, person_name, type Org_detail, type Org_member, type Org_role } from '@/lib/admin';
import { day_month, role_label, type Invite_row } from '@/lib/invites';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Avatar, Banner, Chips, Empty_row, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Member_status_pill, Org_invite_form, Org_status_pill, use_invite, Waiting_owner_banner } from '@/components/graphite/g_invites';
import { Org_mesh_panel } from '@/components/graphite/g_mesh';
import { Secret_reveal } from '@/components/graphite/g_secret';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

/** `org_page/get`: `invites` is null when the caller may not see them; `permissions` is null when the catalogue could not be read. */
interface Org_page_data { org: Org_detail; invites: Invite_row[] | null; permissions: { all: string[]; owner_only: string[] } | null; partial: boolean }

type Tab = 'members' | 'roles' | 'scopes' | 'integrations' | 'a2a' | 'settings';
const JIRA_ON = import.meta.env.VITE_ENABLE_JIRA_INTEGRATION === 'true';
const G_DANGER = 'inline-flex items-center whitespace-nowrap rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] disabled:opacity-40';
type Msg = { tone: 'ok' | 'bad'; text: string } | null;

export const PERMISSION_GROUPS: Array<{ label: string; prefixes: string[] }> = [
	{ label: 'Org', prefixes: ['org.'] },
	{ label: 'Realms', prefixes: ['realms.'] },
	{ label: 'Daemons & tokens', prefixes: ['daemons.', 'tokens.', 'dispatch_keys.'] },
	{ label: 'Team execution', prefixes: ['teams.run', 'teams.cancel', 'teams.inputs', 'teams.install', 'runs.'] },
	{ label: 'Publishing', prefixes: ['teams.publish', 'teams.catalog'] },
	{ label: 'Notifications', prefixes: ['channels.', 'rules.', 'inbox.'] },
	{ label: 'Agents', prefixes: ['agents.'] },
	{ label: 'Reviews', prefixes: ['reviews.'] },
];
export function group_permissions(all: string[]): Array<{ label: string; perms: string[] }> {
	const used = new Set<string>();
	const out = PERMISSION_GROUPS.map((g) => {
		const perms = all.filter((p) => !used.has(p) && g.prefixes.some((x) => p.startsWith(x)));
		perms.forEach((p) => used.add(p));
		return { label: g.label, perms };
	});
	const rest = all.filter((p) => !used.has(p));
	if (rest.length) out.push({ label: 'Other', perms: rest });
	return out.filter((g) => g.perms.length);
}

function role_of(org: Org_detail, m: Org_member): Org_role | null {
	return org.roles.find((r) => r.id === m.role_id) ?? org.roles.find((r) => r.slug === m.role) ?? null;
}

function Members({ data, can_manage, can_invite_owner, reload }: { data: Org_page_data; can_manage: boolean; can_invite_owner: boolean; reload: () => Promise<void> }) {
	const { org } = data;
	const { user } = useAuth();
	const post = use_post();
	const [filter, set_filter] = useState<'all' | 'owner' | 'admin' | 'pending' | 'deleted'>('all');
	const [q, set_q] = useState('');
	const [removing, set_removing] = useState<string | null>(null);
	const [msg, set_msg] = useState<Msg>(null);
	const [busy, set_busy] = useState(false);
	const invite = use_invite({ target_type: 'org', org_id: org.id }, reload);
	const roles = org.roles;
	const invites = (data.invites ?? []).filter((i) => i.status === 'pending');
	// Pending members are listed through their invite (which carries Send again / Revoke); without the invite list they show as plain rows.
	const people = org.members.filter((m) => m.status !== 'pending' || !data.invites);
	const active = org.members.filter((m) => m.status === 'active');
	const deleted = org.members.filter((m) => m.status === 'deleted');
	const by_slug = (slug: string) => active.filter((m) => role_of(org, m)?.slug === slug).length;
	// The org page loads every member, so sorting here is exact.
	const msort = use_table_sort({ keys: ['member', 'role'], mode: 'client', param: 'members' });
	async function run(path: string, body: Record<string, unknown>, ok: string) {
		set_busy(true); set_msg(null);
		const r = await post(path, body);
		set_busy(false);
		set_msg(r.ok ? { tone: 'ok', text: ok } : { tone: 'bad', text: r.error });
		if (r.ok) await reload();
		return r.ok;
	}
	const match = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase());
	const rows = sort_rows(people.filter((m) => {
		if (!match(`${m.username ?? ''} ${m.display_name} ${m.email ?? ''}`)) return false;
		if (filter === 'owner' || filter === 'admin') return m.status === 'active' && role_of(org, m)?.slug === filter;
		if (filter === 'deleted') return m.status === 'deleted';
		if (filter === 'pending') return m.status === 'pending';
		return true;
	}), msort, { member: (m) => person_name(m), role: (m) => role_of(org, m)?.name ?? m.role });
	const shown_invites = filter === 'all' || filter === 'pending' ? invites.filter((i) => match(i.email)) : [];
	return (
		<div className="flex flex-col gap-3">
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			<div className="flex flex-wrap items-center gap-2">
				<Chips value={filter} on_change={set_filter} options={[
					{ key: 'all', label: 'All', count: active.length },
					{ key: 'owner', label: 'Owners', count: by_slug('owner') },
					{ key: 'admin', label: 'Admins', count: by_slug('admin') },
					...(data.invites ? [{ key: 'pending' as const, label: 'Pending invites', count: invites.length, tone: 'warn' as const }] : []),
					...(deleted.length ? [{ key: 'deleted' as const, label: 'Deleted', count: deleted.length }] : []),
				]} />
				<input aria-label="Filter members" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Filter members" className={`${G_INPUT} ml-auto w-[220px]`} />
			</div>
			{can_manage ? <Org_invite_form invite={invite} can_invite_owner={can_invite_owner} /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={msort} k="member" className={TH}>Member</Sort_th><Sort_th sort={msort} k="role" className={TH}>Role</Sort_th><th className={TH}>Status</th><th className={TH} /></tr></thead>
					<tbody>
						{!rows.length && !shown_invites.length ? <Empty_row cols={4}>{filter === 'pending' ? 'No pending invites.' : 'No members match.'}</Empty_row> : null}
						{rows.map((m) => {
							const r = role_of(org, m);
							const me = m.user_id === user?.id;
							const live = m.status === 'active';
							return (
								<tr key={m.user_id} className={`${TR} ${live ? '' : 'text-[var(--g-ink-3)]'}`} data-testid={`member-${m.username ?? m.user_id}`}>
									<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={person_name(m)} /><div className="min-w-0"><b className="font-semibold">{person_name(m)}</b>{me ? <span className="ml-1.5 text-[11.5px] text-[var(--g-ink-3)]">(you)</span> : null}<div className="truncate text-[12px] text-[var(--g-ink-3)]">{m.email ?? handle(m.username)}</div></div></div></td>
									<td className="px-4">
										{can_manage && roles.length && !me && live ? (
											<select aria-label={`Role for ${login_name(m)}`} value={r?.id ?? ''} disabled={busy} onChange={(e) => void (roles.find((x) => x.id === e.target.value)?.slug === 'owner'
												? run('/v1/orgs/update', { org_id: org.id, owner_id: m.user_id }, `${login_name(m)} is now an owner.`)
												: run('/v1/users/update_role', { org_id: org.id, user_id: m.user_id, role_id: e.target.value }, `${login_name(m)} is now ${roles.find((x) => x.id === e.target.value)?.name ?? 'updated'}.`))} className={`${G_INPUT} w-[160px]`}>
												{!r ? <option value="">{m.role}</option> : null}
												{roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
											</select>
										) : <span className="text-[var(--g-ink-2)]">{r?.name ?? m.role}</span>}
									</td>
									<td className="px-4"><Member_status_pill status={m.status} /></td>
									<td className="px-4 text-right">
										{can_manage && !me && live ? (removing === m.user_id
											? <span className="inline-flex gap-2"><button type="button" disabled={busy} onClick={() => void run('/v1/orgs/remove_member', { org_id: org.id, user_id: m.user_id }, `${login_name(m)} removed.`).then(() => set_removing(null))} className={G_DANGER}>Remove {login_name(m)}</button><button type="button" onClick={() => set_removing(null)} className={G_BTN}>Cancel</button></span>
											: <button type="button" onClick={() => set_removing(m.user_id)} className="text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Remove…</button>) : null}
									</td>
								</tr>
							);
						})}
						{shown_invites.map((i) => (
							<tr key={i.invite_id} className={`${TR} bg-[rgba(255,178,36,.04)]`} data-testid={`invite-${i.email}`}>
								<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><span aria-hidden className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-[var(--g-line)] text-[var(--g-ink-3)]">✉</span><div><b>{i.email}</b><div className="text-[12px] text-[var(--g-ink-3)]">Invited{i.inviter ? ` by ${i.inviter.display_name}` : ''}{i.last_sent_at ? ` · sent ${ago(i.last_sent_at)} ago` : ''}{i.send_count > 1 ? ` (${i.send_count}×)` : ''} · expires {day_month(i.expires_at)}</div></div></div></td>
								<td className="px-4 text-[var(--g-ink-2)]">{role_label(i.role)}</td>
								<td className="px-4"><Member_status_pill status="pending" /></td>
								<td className="px-4 text-right">{can_manage ? (
									<span className="inline-flex gap-2">
										<button type="button" disabled={busy || invite.busy} onClick={() => void invite.send(i.email, i.role)} className={G_BTN}>Send again</button>
										<button type="button" disabled={busy} onClick={() => void run('/v1/invitations/revoke', { invite_id: i.invite_id }, `Invite to ${i.email} revoked.`)} className={G_BTN}>Revoke</button>
									</span>
								) : null}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function Roles({ data, can_manage, reload }: { data: Org_page_data; can_manage: boolean; reload: () => Promise<void> }) {
	const { org } = data;
	const post = use_post();
	const roles = org.roles;
	const all = data.permissions?.all ?? [...org.available_permissions, ...org.owner_only_permissions].sort();
	const owner_only = new Set(data.permissions?.owner_only ?? org.owner_only_permissions);
	const groups = useMemo(() => group_permissions(all), [all]);
	const [drafts, set_drafts] = useState<Record<string, Set<string>>>({});
	const [creating, set_creating] = useState<{ slug: string; name: string; from: string | null } | null>(null);
	const [msg, set_msg] = useState<Msg>(null);
	const [busy, set_busy] = useState(false);
	const has = (r: Org_role, p: string) => (drafts[r.id] ?? new Set(r.permissions)).has(p);
	const editable = (r: Org_role) => can_manage && !r.is_system;
	function toggle(r: Org_role, p: string) {
		if (!editable(r) || owner_only.has(p)) return;
		set_drafts((d) => { const s = new Set(d[r.id] ?? r.permissions); if (s.has(p)) s.delete(p); else s.add(p); return { ...d, [r.id]: s }; });
	}
	async function run(path: string, body: Record<string, unknown>, ok: string) {
		set_busy(true); set_msg(null);
		const res = await post(path, { org_id: org.id, ...body });
		set_busy(false);
		set_msg(res.ok ? { tone: 'ok', text: ok } : { tone: 'bad', text: res.error });
		if (res.ok) await reload();
		return res.ok;
	}
	async function create(e: FormEvent) {
		e.preventDefault();
		if (!creating) return;
		const from = roles.find((r) => r.id === creating.from);
		const perms = (from?.permissions ?? []).filter((p) => !owner_only.has(p));
		if (await run('/v1/orgs/create_role', { slug: creating.slug.trim(), name: creating.name.trim(), permissions: perms }, `${creating.name.trim()} created.`)) set_creating(null);
	}
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<p className="text-[12.5px] text-[var(--g-ink-3)]">What each role can do. Built-in roles can be copied, not edited. <Lock className="inline h-3 w-3" /> = owner only.</p>
				{can_manage ? <button type="button" onClick={() => set_creating({ slug: '', name: '', from: null })} className={`${G_PRIMARY} ml-auto`}><Plus className="h-3.5 w-3.5" /> New role</button> : null}
			</div>
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			{creating ? (
				<form onSubmit={(e) => void create(e)} aria-label="New role" className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Name<input aria-label="Role name" value={creating.name} onChange={(e) => set_creating({ ...creating, name: e.target.value, slug: creating.slug || '' })} className={`${G_INPUT} mt-1 block w-[200px]`} /></label>
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Slug<input aria-label="Role slug" value={creating.slug} onChange={(e) => set_creating({ ...creating, slug: e.target.value })} placeholder={creating.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')} className={`${G_INPUT} mt-1 block w-[180px]`} /></label>
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Start from<select aria-label="Start from" value={creating.from ?? ''} onChange={(e) => set_creating({ ...creating, from: e.target.value || null })} className={`${G_INPUT} mt-1 block w-[160px]`}><option value="">No permissions</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
					<button type="submit" disabled={busy || !creating.name.trim() || !/^[a-z][a-z0-9-]*$/.test(creating.slug.trim())} className={G_PRIMARY}>Create role</button>
					<button type="button" onClick={() => set_creating(null)} className={G_BTN}>Cancel</button>
				</form>
			) : null}
			<div className={`${TABLE_WRAP} overflow-x-auto`}>
				<table className="w-full text-[12.5px]" data-testid="roles-grid">
					<thead>
						<tr className="border-b border-[var(--g-line)]">
							<th className={`${TH} w-[240px]`}>Permission</th>
							{roles.map((r) => (
								<th key={r.id} className={`${TH} text-center`}>
									<div>{r.name}{!r.is_system ? <span className="ml-1 text-[var(--g-acc)]">●</span> : null}</div>
									<div className="font-normal normal-case tracking-normal">{r.member_count} {r.member_count === 1 ? 'person' : 'people'}</div>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{groups.map((g) => (
							<FragmentGroup key={g.label} label={g.label} cols={roles.length + 1}>
								{g.perms.map((p) => (
									<tr key={p} className={TR}>
										<td className="g-mono px-4 py-2">{p}{owner_only.has(p) ? <Lock aria-label="owner only" className="ml-1.5 inline h-3 w-3 text-[var(--g-ink-3)]" /> : null}</td>
										{roles.map((r) => {
											const on = has(r, p);
											const can = editable(r) && !owner_only.has(p);
											return (
												<td key={r.id} className="px-2 text-center">
													<button type="button" aria-label={`${r.name}: ${p}`} aria-pressed={on} disabled={!can} onClick={() => toggle(r, p)} className={`h-6 w-6 rounded ${can ? 'hover:bg-[var(--g-soft)]' : 'cursor-default'} ${on ? (r.is_system ? 'text-[var(--g-ok)]' : 'text-[var(--g-acc)]') : 'text-[#3a3d44]'}`}>{on ? '✓' : '—'}</button>
												</td>
											);
										})}
									</tr>
								))}
							</FragmentGroup>
						))}
						<tr>
							<td className="px-4 py-2.5 text-[var(--g-ink-3)]" />
							{roles.map((r) => (
								<td key={r.id} className="px-2 py-2.5 text-center">
									{editable(r) ? (
										<span className="inline-flex flex-col items-center gap-1">
											<button type="button" disabled={busy || !drafts[r.id]} onClick={() => void run('/v1/orgs/update_role', { role_id: r.id, name: r.name, permissions: [...(drafts[r.id] ?? [])] }, `${r.name} saved.`).then((ok) => ok && set_drafts((d) => { const n = { ...d }; delete n[r.id]; return n; }))} className={G_PRIMARY}>Save</button>
											{!r.is_default ? <button type="button" disabled={busy || r.member_count > 0} title={r.member_count > 0 ? 'Reassign its members first' : undefined} onClick={() => void run('/v1/orgs/delete_role', { role_id: r.id }, `${r.name} deleted.`)} className="text-[11.5px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)] disabled:opacity-40">Delete</button> : null}
										</span>
									) : can_manage ? <button type="button" onClick={() => set_creating({ slug: `${r.slug}-copy`, name: `${r.name} (copy)`, from: r.id })} className="text-[11.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">Copy as new</button> : null}
								</td>
							))}
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	);
}

function FragmentGroup({ label, cols, children }: { label: string; cols: number; children: React.ReactNode }) {
	return (
		<>
			<tr><td colSpan={cols} className="bg-[#0f1012] px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">{label}</td></tr>
			{children}
		</>
	);
}

function Scopes({ data, can_manage, reload }: { data: Org_page_data; can_manage: boolean; reload: () => Promise<void> }) {
	const { org } = data;
	const post = use_post();
	const [open, set_open] = useState<string | null>(null);
	const [f, set_f] = useState<{ slug: string; name: string; visibility: 'private' | 'public' } | null>(null);
	const [msg, set_msg] = useState<Msg>(null);
	const [busy, set_busy] = useState(false);
	const [confirm, set_confirm] = useState<string | null>(null);
	async function run(path: string, body: Record<string, unknown>, ok: string) {
		set_busy(true); set_msg(null);
		const r = await post(path, { org_id: org.id, ...body });
		set_busy(false);
		set_msg(r.ok ? { tone: 'ok', text: ok } : { tone: 'bad', text: r.error });
		if (r.ok) await reload();
		return r.ok;
	}
	const non_admins = org.members.filter((m) => m.status === 'active' && !['owner', 'admin'].includes(role_of(org, m)?.slug ?? m.role));
	const ssort = use_table_sort({ keys: ['scope', 'visibility', 'members', 'teams'], mode: 'client', param: 'scopes', first_dir: { members: 'desc', teams: 'desc' } });
	const scopes = sort_rows(org.scopes, ssort, { scope: (x) => x.slug, visibility: (x) => x.visibility, members: (x) => x.member_count, teams: (x) => x.team_count });
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<p className="text-[12.5px] text-[var(--g-ink-3)]">Publishing namespaces for this org (<span className="g-mono">@scope/team</span>). Owners and admins can publish to every scope; give other members access per scope.</p>
				{can_manage ? <button type="button" onClick={() => set_f({ slug: '', name: '', visibility: 'private' })} className={`${G_PRIMARY} ml-auto`}><Plus className="h-3.5 w-3.5" /> New scope</button> : null}
			</div>
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			{f ? (
				<form onSubmit={(e) => { e.preventDefault(); void run('/v1/orgs/new_scope', { slug: f.slug.trim(), visibility: f.visibility, ...(f.name.trim() ? { display_name: f.name.trim() } : {}) }, `@${f.slug.trim()} created.`).then((ok) => ok && set_f(null)); }} aria-label="New scope" className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Slug<input aria-label="Scope slug" value={f.slug} onChange={(e) => set_f({ ...f, slug: e.target.value })} placeholder={`${org.slug}-data`} className={`${G_INPUT} mt-1 block w-[200px]`} /></label>
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Name<input aria-label="Scope name" value={f.name} onChange={(e) => set_f({ ...f, name: e.target.value })} className={`${G_INPUT} mt-1 block w-[200px]`} /></label>
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Visibility<select aria-label="Scope visibility" value={f.visibility} onChange={(e) => set_f({ ...f, visibility: e.target.value as 'private' | 'public' })} className={`${G_INPUT} mt-1 block w-[120px]`}><option value="private">private</option><option value="public">public</option></select></label>
					<button type="submit" disabled={busy || !/^[a-z][a-z0-9-]*$/.test(f.slug.trim())} className={G_PRIMARY}>Create scope</button>
					<button type="button" onClick={() => set_f(null)} className={G_BTN}>Cancel</button>
				</form>
			) : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={ssort} k="scope" className={TH}>Scope</Sort_th><Sort_th sort={ssort} k="visibility" className={TH}>Visibility</Sort_th><Sort_th sort={ssort} k="members" className={TH}>Members</Sort_th><Sort_th sort={ssort} k="teams" className={TH}>Teams</Sort_th><th className={TH} /></tr></thead>
					<tbody>
						{!org.scopes.length ? <Empty_row cols={5}>No scopes.</Empty_row> : null}
						{scopes.map((s) => (
							<FragmentScope key={s.id} open={open === s.id} cols={5} row={(
								<tr className={TR} data-testid={`scope-${s.slug}`}>
									<td className="px-4 py-2.5"><button type="button" aria-expanded={open === s.id} onClick={() => set_open(open === s.id ? null : s.id)} className="g-mono font-semibold hover:underline">@{s.slug}</button>{s.display_name && s.display_name !== s.slug ? <span className="ml-2 text-[var(--g-ink-3)]">{s.display_name}</span> : null}</td>
									<td className="px-4"><Pill tone={s.visibility === 'public' ? 'ok' : 'muted'}>{s.visibility}</Pill></td>
									<td className="g-mono px-4">{s.member_count}</td>
									<td className="g-mono px-4">{s.team_count}</td>
									<td className="px-4 text-right">
										{can_manage ? (s.team_count > 0 ? <span className="text-[11.5px] text-[var(--g-ink-3)]">has teams</span> : confirm === s.id
											? <span className="inline-flex gap-2"><button type="button" disabled={busy} onClick={() => void run('/v1/orgs/delete_scope', { scope_id: s.id }, `@${s.slug} deleted.`).then(() => set_confirm(null))} className={G_DANGER}>Delete @{s.slug}</button><button type="button" onClick={() => set_confirm(null)} className={G_BTN}>Cancel</button></span>
											: <button type="button" onClick={() => set_confirm(s.id)} className="text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Delete…</button>) : null}
									</td>
								</tr>
							)}>
								<tr className={TR}><td colSpan={5} className="bg-[var(--g-bg)] px-4 py-3">
									{!can_manage ? <p className="text-[12.5px] text-[var(--g-ink-3)]">Only owners and admins manage scope access.</p> : !non_admins.length ? <p className="text-[12.5px] text-[var(--g-ink-3)]">Everyone here is an owner or admin, so they can already publish to @{s.slug}.</p> : (
										<ul className="flex flex-col gap-1.5">{non_admins.map((m) => (
											<li key={m.user_id} className="flex items-center gap-2 text-[12.5px]"><span className="g-mono">{handle(m.username)}</span>
												<span className="ml-auto flex gap-2"><button type="button" disabled={busy} onClick={() => void run('/v1/orgs/assign_scope_member', { scope_id: s.id, user_id: m.user_id }, `${handle(m.username)} can publish to @${s.slug}.`)} className={G_BTN}>Give access</button><button type="button" disabled={busy} onClick={() => void run('/v1/orgs/unassign_scope_member', { scope_id: s.id, user_id: m.user_id }, `${handle(m.username)} no longer publishes to @${s.slug}.`)} className={G_BTN}>Remove access</button></span>
											</li>
										))}</ul>
									)}
								</td></tr>
							</FragmentScope>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function FragmentScope({ open, row, children }: { open: boolean; cols: number; row: React.ReactNode; children: React.ReactNode }) {
	return <>{row}{open ? children : null}</>;
}

interface Jira_binding { realm_id: string; realm_slug: string; realm_name: string; channel_id: string | null; workspace_id: string | null; connected_at: number | null }

function Integrations() {
	const post = use_post();
	const read = use_bff_read<{ workspaces: Jira_binding[] }>('/v1/integrations/jira/get_workspaces', {}, { fallback_error: 'Jira integration isn’t available on this hub.' });
	const [secret, set_secret] = useState<string | null>(null);
	const [confirm, set_confirm] = useState<string | null>(null);
	const [msg, set_msg] = useState<Msg>(null);
	const [busy, set_busy] = useState(false);
	async function run(path: string, b: Jira_binding, ok: string) {
		set_busy(true); set_msg(null);
		const r = await post(path, { realm_id: b.realm_id, workspace_id: b.workspace_id });
		set_busy(false); set_confirm(null);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		if (path.endsWith('rotate_secret')) set_secret(String((r.data as { secret?: string }).secret ?? ''));
		else set_msg({ tone: 'ok', text: ok });
		void read.reload();
	}
	const jsort = use_table_sort({ keys: ['realm', 'workspace', 'connected_at'], mode: 'client', param: 'jira', first_dir: { connected_at: 'desc' } });
	const rows = sort_rows(read.data?.workspaces ?? [], jsort, { realm: (b) => b.realm_name || b.realm_slug, workspace: (b) => b.workspace_id, connected_at: (b) => b.connected_at });
	return (
		<div className="flex flex-col gap-3">
			<p className="max-w-[720px] text-[12.5px] text-[var(--g-ink-3)]">Jira posts run events onto issues through the Cliq Forge app. Install the app in your Jira site and paste a personal access token there; each realm connects the first time a run is dispatched from Jira.</p>
			{secret ? <Secret_reveal title="New Jira shared secret" secret={secret} note="Paste it into the Forge app settings for that workspace." on_done={() => set_secret(null)} /> : null}
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			{read.status === 'error' && !read.data ? <Banner tone="bad">{read.error}</Banner> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={jsort} k="realm" className={TH}>Realm</Sort_th><Sort_th sort={jsort} k="workspace" className={TH}>Jira workspace</Sort_th><Sort_th sort={jsort} k="connected_at" className={TH}>Connected</Sort_th><th className={TH} /></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={4}>Loading…</Empty_row> : null}
						{read.data && !rows.length ? <Empty_row cols={4}>No realms you administer yet.</Empty_row> : null}
						{rows.map((b) => {
							const key = `${b.realm_id}:${b.workspace_id}`;
							return (
								<tr key={key} className={TR}>
									<td className="px-4 py-2.5"><b>{b.realm_name || b.realm_slug}</b> <span className="g-mono text-[12px] text-[var(--g-ink-3)]">{b.realm_slug}</span></td>
									<td className="g-mono px-4">{b.workspace_id ?? <Pill tone="muted">not connected</Pill>}</td>
									<td className="px-4 text-[var(--g-ink-3)]">{b.connected_at ? `${ago(b.connected_at)} ago` : '—'}</td>
									<td className="px-4 text-right">
										{b.workspace_id ? (confirm === key
											? <span className="inline-flex items-center gap-2 text-[12px]"><span className="text-[var(--g-ink-3)]">Also uninstall the Forge app to stop delivery.</span><button type="button" disabled={busy} onClick={() => void run('/v1/integrations/jira/disconnect_workspace', b, `Disconnected ${b.workspace_id}.`)} className={G_DANGER}>Disconnect</button><button type="button" onClick={() => set_confirm(null)} className={G_BTN}>Cancel</button></span>
											: <span className="inline-flex gap-2"><button type="button" disabled={busy} onClick={() => void run('/v1/integrations/jira/rotate_secret', b, '')} className={G_BTN}>Rotate secret</button><button type="button" onClick={() => set_confirm(key)} className={G_DANGER}>Disconnect…</button></span>) : null}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function Settings({ data, can_manage, reload }: { data: Org_page_data; can_manage: boolean; reload: () => Promise<void> }) {
	const { org } = data;
	const { user } = useAuth();
	const navigate = useNavigate();
	const post = use_post();
	const [name, set_name] = useState(org.display_name);
	const [leave, set_leave] = useState(false);
	const [msg, set_msg] = useState<Msg>(null);
	const [busy, set_busy] = useState(false);
	const personal = org.slug === user?.username;
	return (
		<div className="flex max-w-[560px] flex-col gap-4">
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			<form onSubmit={(e) => { e.preventDefault(); set_busy(true); void post('/v1/orgs/update', { org_id: org.id, display_name: name.trim() }).then(async (r) => { set_busy(false); set_msg(r.ok ? { tone: 'ok', text: 'Name saved.' } : { tone: 'bad', text: r.error }); if (r.ok) await reload(); }); }} className="flex flex-col gap-2 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" aria-label="Organization name">
				<label className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">Display name<input aria-label="Organization name" disabled={!can_manage} value={name} onChange={(e) => set_name(e.target.value)} className={`${G_INPUT} w-full`} /></label>
				<p className="text-[11.5px] text-[var(--g-ink-3)]">Slug <span className="g-mono">{org.slug}</span> can’t be changed.</p>
				{can_manage ? <div><button type="submit" disabled={busy || !name.trim() || name.trim() === org.display_name} className={G_PRIMARY}>Save</button></div> : null}
			</form>
			{!personal ? (
				<div className="flex flex-col gap-2 rounded-[10px] border border-[var(--g-bad-line)] p-4">
					<b className="text-[13.5px]">Leave {org.display_name || org.slug}</b>
					<p className="text-[12.5px] text-[var(--g-ink-2)]">You lose access to its realms and teams. An owner can add you back.</p>
					{leave
						? <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { set_busy(true); void post('/v1/orgs/leave', { org_id: org.id }).then((r) => { set_busy(false); if (r.ok) navigate('/home', { replace: true }); else set_msg({ tone: 'bad', text: r.error }); }); }} className={G_DANGER}>Leave organization</button><button type="button" onClick={() => set_leave(false)} className={G_BTN}>Cancel</button></div>
						: <div><button type="button" onClick={() => set_leave(true)} className={G_DANGER}>Leave…</button></div>}
				</div>
			) : null}
			<p className="text-[12px] text-[var(--g-ink-3)]">Deleting an organization is done by a CliqHub admin.</p>
		</div>
	);
}

export function Component() {
	const { id = '' } = useParams();
	const [sp, set_sp] = useSearchParams();
	const overview = use_overview();
	const { user } = useAuth();
	const read = use_bff_read<Org_page_data>('/v1/org_page/get', id ? { org_id: id } : null, { fallback_error: 'Could not load the organization.' });
	const d = read.data;
	const tabs: Array<[Tab, string]> = [['members', 'Members'], ['roles', 'Roles'], ['scopes', 'Scopes'], ...(JIRA_ON ? [['integrations', 'Integrations'] as [Tab, string]] : []), ['a2a', 'A2A'], ['settings', 'Settings']];
	const tab = (tabs.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'members') as Tab;
	const my_role = d?.org.my_role ?? '';
	const can_manage = my_role === 'owner' || my_role === 'admin' || my_role === 'site_admin' || user?.role === 'admin';
	const can_invite_owner = my_role === 'owner' || my_role === 'site_admin' || user?.role === 'admin';
	const member_count = d ? d.org.members.filter((m) => m.status === 'active').length : 0;
	const reload = async () => { await read.reload(); };
	return (
		<Graphite_shell data={overview.data} title="Organization">
			<div className="flex flex-col gap-4 px-7 py-6">
				{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="organization" /> : null}
				{!d && read.status !== 'error' ? <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" /> : null}
				{d ? (
					<>
						<header className="flex flex-wrap items-center gap-3">
							<Avatar name={d.org.display_name || d.org.slug} size={44} />
							<div><h1 className="text-[22px] font-semibold tracking-tight">{d.org.display_name || d.org.slug}</h1><p className="text-[12.5px] text-[var(--g-ink-3)]">{my_role === 'site_admin' ? 'Viewing as CliqHub admin' : `You’re ${/^[aeiou]/i.test(my_role) ? 'an' : 'a'} ${my_role}`} · {member_count} member{member_count === 1 ? '' : 's'} · {d.org.scopes.length} scope{d.org.scopes.length === 1 ? '' : 's'}</p></div>
							{d.org.status !== 'active' ? <Org_status_pill status={d.org.status} /> : null}
							<Link to={`/realms?org=${encodeURIComponent(d.org.slug)}`} className={`${G_BTN} ml-auto`}>Realms →</Link>
						</header>
						{d.org.status === 'waiting_for_owner' ? <Waiting_owner_banner invite={d.org.pending_owner_invite} /> : null}
						<div role="tablist" aria-label="Organization" className="flex gap-1 border-b border-[var(--g-line)]">
							{tabs.map(([k, l]) => (
								<button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => set_sp(k === 'members' ? {} : { tab: k }, { replace: true })} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === k ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>{l}</button>
							))}
						</div>
						{!can_manage && tab !== 'settings' ? <p className="text-[12.5px] text-[var(--g-ink-3)]">You can see this organization; its owners and admins manage it.</p> : null}
						{tab === 'members' ? <Members data={d} can_manage={can_manage} can_invite_owner={can_invite_owner} reload={reload} /> : null}
						{tab === 'roles' ? <Roles data={d} can_manage={can_manage} reload={reload} /> : null}
						{tab === 'scopes' ? <Scopes data={d} can_manage={can_manage} reload={reload} /> : null}
						{tab === 'integrations' ? <Integrations /> : null}
						{tab === 'a2a' ? <Org_mesh_panel org_id={d.org.id} can_edit={can_manage} /> : null}
						{tab === 'settings' ? <Settings data={d} can_manage={can_manage} reload={reload} /> : null}
					</>
				) : null}
			</div>
		</Graphite_shell>
	);
}
