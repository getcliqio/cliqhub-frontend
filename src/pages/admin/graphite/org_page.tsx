/**
 * Admin › Organizations › one org (AD3) — members, realms, scopes, roles, settings.
 * Reads: `POST /v1/orgs/get_by_id` (members, scopes, roles in one call);
 *        Realms tab: `POST /v1/realms/get {org_id, all}` (all → Core API 3; older Core
 *        ignores it and returns only realms you're in).
 * Writes: users/update_role · invitations/create · orgs/remove_member · orgs/update · orgs/delete.
 * The header shows the org's status, and a Waiting-for-owner banner (who, when the invite expires) until the owner accepts.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { use_bff_read } from '@/lib/use_bff_read';
import { handle, login_name, month_year, owners_of, person_name, type Org_detail, type Org_member } from '@/lib/admin';
import { Avatar, Banner, Empty_row, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { Member_status_pill, Org_invite_form, Org_status_pill, use_invite, Waiting_owner_banner } from '@/components/graphite/g_invites';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Tab = 'members' | 'realms' | 'scopes' | 'roles' | 'settings';
const TABS: Array<[Tab, string]> = [['members', 'Members'], ['realms', 'Realms'], ['scopes', 'Scopes'], ['roles', 'Roles'], ['settings', 'Settings']];
const G_DANGER = 'inline-flex items-center whitespace-nowrap rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] disabled:opacity-40';

function role_of(org: Org_detail, m: Org_member) {
	return org.roles.find((r) => r.id === m.role_id) ?? org.roles.find((r) => r.slug === m.role) ?? null;
}

function Realms_tab({ org }: { org: Org_detail }) {
	// realms/get sorts in Core (before its 100-row cap), so every column it offers is exact.
	const sort = use_table_sort({ keys: ['slug', 'created_at'], mode: 'client', default_sort: { by: 'slug', dir: 'asc' }, first_dir: { created_at: 'desc' } });
	const read = use_bff_read<{ items: Array<{ id: string; slug: string; name: string; org_slug: string | null; created_at: number }>; total: number }>('/v1/realms/get', { org_id: org.id, all: true, limit: 100, ...sort.body }, { fallback_error: 'Could not load realms.' });
	const items = read.data?.items ?? [];
	return (
		<div className={TABLE_WRAP}>
			<table className="w-full text-[13px]">
				<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={sort} k="slug" className={TH}>Realm</Sort_th><Sort_th sort={sort} k="created_at" className={TH}>Created</Sort_th><th className={TH} /></tr></thead>
				<tbody>
					{read.status === 'loading' ? <Empty_row cols={3}>Loading…</Empty_row> : null}
					{read.status === 'error' ? <Empty_row cols={3}>{read.error}</Empty_row> : null}
					{read.data && !items.length ? <Empty_row cols={3}>No realms you can see. On Core API 3 this lists every realm in {org.slug}.</Empty_row> : null}
					{items.map((r) => (
						<tr key={r.id} className={TR}>
							<td className="px-4 py-2.5"><b>{r.name || r.slug}</b> <span className="g-mono text-[12px] text-[var(--g-ink-3)]">{r.slug}</span></td>
							<td className="px-4 text-[var(--g-ink-3)]">{r.created_at ? month_year(new Date(r.created_at).toISOString()) : '—'}</td>
							<td className="px-4 text-right"><Link to={`/o/${org.slug}/realms/${r.slug}`} className="text-[12.5px] text-[var(--g-acc)]">Open realm →</Link></td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function Component() {
	const { id = '' } = useParams();
	const navigate = useNavigate();
	const [sp, set_sp] = useSearchParams();
	const tab = (TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'members') as Tab;
	const post = use_post();
	const read = use_bff_read<Org_detail>('/v1/orgs/get_by_id', { org_id: id }, { fallback_error: 'Could not load the organization.' });
	const org = read.data;
	const [busy, set_busy] = useState(false);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [name, set_name] = useState<string | null>(null);
	const [confirm, set_confirm] = useState('');
	// Members / scopes / roles all come with the org (no paging): sorted here.
	const member_sort = use_table_sort({ keys: ['member', 'member_role'], mode: 'client' });
	const scope_sort = use_table_sort({ keys: ['scope', 'visibility', 'scope_members', 'scope_teams'], mode: 'client', first_dir: { scope_members: 'desc', scope_teams: 'desc' } });
	const role_sort = use_table_sort({ keys: ['role', 'role_members', 'role_type'], mode: 'client', first_dir: { role_members: 'desc' } });
	const invite = use_invite({ target_type: 'org', org_id: id }, async () => { await read.reload(); });

	async function run(path: string, body: Record<string, unknown>, ok_text: string, after?: () => void) {
		set_busy(true); set_msg(null);
		const r = await post(path, { org_id: id, ...body });
		set_busy(false);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return false; }
		set_msg({ tone: 'ok', text: ok_text });
		if (after) after(); else await read.reload();
		return true;
	}

	if (read.status === 'error' && !org) return <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="organization" />;
	if (!org) return <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />;

	const members = sort_rows(org.members, member_sort, { member: (m) => person_name(m), member_role: (m) => role_of(org, m)?.name ?? m.role });
	const scopes = sort_rows(org.scopes, scope_sort, { scope: (x) => x.slug, visibility: (x) => x.visibility, scope_members: (x) => x.member_count, scope_teams: (x) => x.team_count });
	const roles = sort_rows(org.roles, role_sort, { role: (r) => r.name, role_members: (r) => org.members.filter((m) => role_of(org, m)?.id === r.id).length, role_type: (r) => (r.is_system ? 'built-in' : 'custom') });
	const owners = owners_of(org);
	const owner_role = org.roles.find((r) => r.slug === 'owner') ?? null;
	const current = org.members.filter((m) => m.status === 'active');
	const candidate = current.find((m) => role_of(org, m)?.slug === 'admin') ?? current[0] ?? null;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<Avatar name={org.display_name || org.slug} size={44} />
				<div className="min-w-0">
					<h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">{org.display_name || org.slug} <span className="g-mono text-[13px] font-normal text-[var(--g-ink-3)]">{org.slug}</span><Org_status_pill status={org.deleted_at ? 'deleted' : org.status} />{owners.length === 0 && owner_role ? <Pill tone="warn">! No owner</Pill> : null}</h1>
					<p className="text-[12.5px] text-[var(--g-ink-3)]">Created {month_year(org.created_at)} · {current.length} member{current.length === 1 ? '' : 's'} · {org.scopes.length} scope{org.scopes.length === 1 ? '' : 's'}</p>
				</div>
				<Link to={`/orgs/${org.id}`} className={`${G_BTN} ml-auto`}>Open org page <ExternalLink className="h-3.5 w-3.5" /></Link>
			</div>

			<div role="tablist" aria-label="Organization" className="flex gap-1 border-b border-[var(--g-line)]">
				{TABS.map(([k, l]) => (
					<button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => set_sp(k === 'members' ? {} : { tab: k }, { replace: true })} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === k ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>{l}</button>
				))}
			</div>

			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}

			{org.status === 'waiting_for_owner' && !org.deleted_at ? <Waiting_owner_banner invite={org.pending_owner_invite} /> : null}

			{owners.length === 0 && owner_role && org.members.length ? (
				<div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[rgba(255,178,36,.4)] bg-[var(--g-warn-soft)] px-4 py-3" data-testid="ownerless">
					<div className="min-w-0 flex-1"><b className="text-[13.5px]">This org has no owner</b><p className="text-[12.5px] text-[var(--g-ink-2)]">Nobody can manage owner-only settings or delete the org.</p></div>
					{candidate ? <button type="button" disabled={busy} onClick={() => void run('/v1/orgs/update', { owner_id: candidate.user_id }, `${login_name(candidate)} is now an owner`)} className={G_PRIMARY}>Make {person_name(candidate)} owner</button> : null}
				</div>
			) : null}

			{tab === 'members' ? (
				<div className={TABLE_WRAP}>
					<table className="w-full text-[13px]">
						<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={member_sort} k="member" className={TH}>Member</Sort_th><Sort_th sort={member_sort} k="member_role" className={TH}>Role</Sort_th><th className={TH}>Status</th><th className={TH} /></tr></thead>
						<tbody>
							{org.members.length === 0 ? <Empty_row cols={4}>No members.</Empty_row> : null}
							{members.map((m) => {
								const r = role_of(org, m);
								const live = m.status === 'active';
								return (
									<tr key={m.user_id} className={TR} data-testid={`member-${m.username ?? m.user_id}`}>
										<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={person_name(m)} /><div className="min-w-0"><Link to={`/admin/accounts?u=${m.user_id}`} className="font-semibold hover:underline">{person_name(m)}</Link><div className="truncate text-[12px] text-[var(--g-ink-3)]">{m.email ?? handle(m.username)}</div></div></div></td>
										<td className="px-4">
											{org.roles.length && live ? (
												<select aria-label={`Role for ${login_name(m)}`} value={r?.id ?? ''} disabled={busy} onChange={(e) => void (e.target.value === owner_role?.id
													? run('/v1/orgs/update', { owner_id: m.user_id }, `${login_name(m)} is now an owner`)
													: run('/v1/users/update_role', { user_id: m.user_id, role_id: e.target.value }, `${login_name(m)} is now ${org.roles.find((x) => x.id === e.target.value)?.name ?? 'updated'}`))} className={`${G_INPUT} w-[160px]`}>
													{!r ? <option value="">{m.role}</option> : null}
													{org.roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
												</select>
											) : <span>{r?.name ?? m.role}</span>}
										</td>
										<td className="px-4"><Member_status_pill status={m.status} /></td>
										<td className="px-4 text-right">{live ? <button type="button" disabled={busy} onClick={() => void run('/v1/orgs/remove_member', { user_id: m.user_id }, `${login_name(m)} removed`)} className="text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Remove</button> : null}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					{org.deleted_at ? null : <div className="border-t border-[var(--g-line)] px-4 py-3"><Org_invite_form invite={invite} can_invite_owner /></div>}
				</div>
			) : null}

			{tab === 'realms' ? <Realms_tab org={org} /> : null}

			{tab === 'scopes' ? (
				<div className={TABLE_WRAP}>
					<table className="w-full text-[13px]">
						<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={scope_sort} k="scope" className={TH}>Scope</Sort_th><Sort_th sort={scope_sort} k="visibility" className={TH}>Visibility</Sort_th><Sort_th sort={scope_sort} k="scope_members" className={TH}>Members</Sort_th><Sort_th sort={scope_sort} k="scope_teams" className={TH}>Teams</Sort_th></tr></thead>
						<tbody>
							{org.scopes.length === 0 ? <Empty_row cols={4}>No scopes.</Empty_row> : null}
							{scopes.map((s) => (
								<tr key={s.id} className={TR}><td className="g-mono px-4 py-2.5">@{s.slug}</td><td className="px-4 text-[var(--g-ink-3)]">{s.visibility}</td><td className="g-mono px-4">{s.member_count}</td><td className="g-mono px-4">{s.team_count}</td></tr>
							))}
						</tbody>
					</table>
					<p className="border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">Create, rename or re-assign scopes in <Link to="/admin/scopes" className="text-[var(--g-acc)]">Scopes</Link>.</p>
				</div>
			) : null}

			{tab === 'roles' ? (
				<div className={TABLE_WRAP}>
					<table className="w-full text-[13px]">
						<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={role_sort} k="role" className={TH}>Role</Sort_th><Sort_th sort={role_sort} k="role_members" className={TH}>Members</Sort_th><Sort_th sort={role_sort} k="role_type" className={TH}>Type</Sort_th></tr></thead>
						<tbody>
							{org.roles.length === 0 ? <Empty_row cols={3}>No roles.</Empty_row> : null}
							{roles.map((r) => (
								<tr key={r.id} className={TR}><td className="px-4 py-2.5"><b>{r.name}</b> <span className="g-mono text-[12px] text-[var(--g-ink-3)]">{r.slug}</span></td><td className="g-mono px-4">{org.members.filter((m) => role_of(org, m)?.id === r.id).length}</td><td className="px-4 text-[var(--g-ink-3)]">{r.is_system ? 'built-in' : 'custom'}</td></tr>
							))}
						</tbody>
					</table>
					<p className="border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">Permissions per role are edited by the org’s own admins in their org settings.</p>
				</div>
			) : null}

			{tab === 'settings' ? (
				<div className="flex max-w-[560px] flex-col gap-4">
					<form className="flex flex-col gap-2 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" onSubmit={(e) => { e.preventDefault(); if (name?.trim()) void run('/v1/orgs/update', { display_name: name.trim() }, 'Name saved'); }}>
						<label className="text-[12.5px] text-[var(--g-ink-2)]">Display name<input aria-label="Display name" value={name ?? org.display_name} onChange={(e) => set_name(e.target.value)} className={`${G_INPUT} mt-1 w-full`} /></label>
						<button type="submit" disabled={busy || !name?.trim() || name.trim() === org.display_name} className={`${G_PRIMARY} self-start`}>Save</button>
					</form>
					<form className="flex flex-col gap-2 rounded-[10px] border border-[var(--g-bad-line)] p-4" onSubmit={(e) => { e.preventDefault(); void run('/v1/orgs/delete', {}, `${org.slug} deleted`, () => navigate('/admin/orgs')); }}>
						<b className="text-[13.5px] text-[var(--g-bad)]">Delete organization</b>
						<p className="text-[12.5px] text-[var(--g-ink-2)]">Deletes {org.slug}. Its history is kept and the name stays taken; creating it again offers to reactivate it. Type <span className="g-mono">{org.slug}</span> to confirm.</p>
						<input aria-label="Confirm slug" value={confirm} onChange={(e) => set_confirm(e.target.value)} className={`${G_INPUT} w-full`} />
						<button type="submit" disabled={busy || confirm !== org.slug} className={`${G_DANGER} self-start`}>Delete {org.slug}</button>
					</form>
				</div>
			) : null}
		</div>
	);
}
