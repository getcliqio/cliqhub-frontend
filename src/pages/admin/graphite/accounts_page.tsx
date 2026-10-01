/**
 * Admin › Accounts (AD2) — every account on the hub, with a side panel.
 * Read: `POST /v1/admin_list/get {kind:'accounts'}` (rows + chip counts);
 *       `POST /v1/users/get_by_id` for the selected account.
 * Writes: users/suspend · unsuspend · set_role · reset_password · update · delete · new;
 *         act-as via session/update (auth context).
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, X } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, month_year, type Admin_account_row, type Admin_list_data, type Admin_user_detail } from '@/lib/admin';
import { Admin_header, Avatar, Banner, Chips, Empty_row, Pager, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Filter = 'all' | 'admins' | 'suspended';
const LIMIT = 25;
const G_DANGER = 'inline-flex items-center whitespace-nowrap rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] disabled:opacity-40';

type Dialog = null | 'suspend' | 'password' | 'edit' | 'delete' | 'new';

function Account_panel({ id, on_close, on_changed }: { id: string; on_close: () => void; on_changed: (msg: string) => void }) {
	const { user: me, act_as } = useAuth();
	const navigate = useNavigate();
	const post = use_post();
	const read = use_bff_read<Admin_user_detail>('/v1/users/get_by_id', { user_id: id }, { fallback_error: 'Could not load the account.' });
	const [dialog, set_dialog] = useState<Dialog>(null);
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const [f, set_f] = useState<Record<string, string>>({});
	const u = read.data;
	const is_me = me?.id === id;
	const name = u ? (u.display_name || u.username) : '';

	async function run(path: string, body: Record<string, unknown>, msg: string, after?: () => void) {
		set_busy(true); set_err(null);
		const r = await post(path, { user_id: id, ...body });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		set_dialog(null); set_f({});
		await read.reload();
		on_changed(msg);
		after?.();
	}

	async function take_over() {
		set_busy(true); set_err(null);
		const e = await act_as(id);
		set_busy(false);
		if (e) { set_err(e); return; }
		navigate('/home', { replace: true });
	}

	return (
		<aside aria-label="Account" className="flex flex-col self-start rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" data-testid="account-panel">
			{!u ? <div className="h-[260px] animate-pulse" aria-busy="true" /> : (
				<>
					<div className="flex items-start gap-3 border-b border-[var(--g-line)] p-4">
						<Avatar name={name} size={44} />
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-2"><b className="text-[15px]">{name}</b>{u.suspended_at ? <Pill tone="bad">Suspended</Pill> : null}{u.role === 'admin' ? <Pill tone="warn">Site admin</Pill> : null}</div>
							<p className="truncate text-[12.5px] text-[var(--g-ink-3)]">{u.email} · @{u.username} · joined {month_year(u.created_at)}</p>
						</div>
						<button type="button" aria-label="Close" onClick={on_close} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
					</div>
					{u.suspended_at ? (
						<div className="border-b border-[var(--g-line)] bg-[var(--g-bad-soft)] px-4 py-3 text-[12.5px]">
							<b className="text-[var(--g-bad)]">Suspended {ago(u.suspended_at)} ago</b>{u.suspended_reason ? <span className="text-[var(--g-ink-2)]"> — {u.suspended_reason}</span> : null}
							<div className="mt-2"><button type="button" disabled={busy} onClick={() => void run('/v1/users/unsuspend', {}, `${u.username} unsuspended`)} className={G_BTN}>Unsuspend</button></div>
						</div>
					) : null}
					<div className="border-b border-[var(--g-line)] px-4 py-3">
						<div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Organizations</div>
						{u.orgs?.length ? u.orgs.map((o) => (
							<div key={o.id} className="flex justify-between py-0.5 text-[13px]"><Link to={`/admin/orgs/${o.id}`} className="hover:underline">{o.display_name || o.slug}</Link><span className="text-[var(--g-ink-3)]">{o.role}</span></div>
						)) : <p className="text-[12.5px] text-[var(--g-ink-3)]">Not in any org.</p>}
					</div>
					<div className="border-b border-[var(--g-line)] px-4 py-3 text-[12.5px] text-[var(--g-ink-2)]">
						<div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Owns</div>
						{[[u.team_count, 'team'], [u.scope_count, 'scope'], [u.token_count, 'access token'], [u.draft_count, 'draft']].map(([n, w]) => `${n ?? 0} ${w}${n === 1 ? '' : 's'}`).join(' · ')}
					</div>
					<div className="flex flex-wrap gap-2 px-4 py-3">
						{!is_me ? <button type="button" disabled={busy || Boolean(u.suspended_at)} onClick={() => void take_over()} className={G_BTN}>Act as {u.username}</button> : null}
						{!is_me ? <button type="button" disabled={busy} onClick={() => void run('/v1/users/set_role', { role: u.role === 'admin' ? 'user' : 'admin' }, u.role === 'admin' ? `${u.username} is no longer a site admin` : `${u.username} is now a site admin`)} className={G_BTN}>{u.role === 'admin' ? 'Remove site admin' : 'Make site admin'}</button> : null}
						<button type="button" onClick={() => { set_f({ display_name: u.display_name, email: u.email }); set_dialog('edit'); }} className={G_BTN}>Edit profile</button>
						<button type="button" onClick={() => set_dialog('password')} className={G_BTN}>Set new password</button>
						{!is_me && !u.suspended_at ? <button type="button" onClick={() => set_dialog('suspend')} className={G_BTN}>Suspend…</button> : null}
						{!is_me ? <button type="button" onClick={() => set_dialog('delete')} className={G_DANGER}>Delete account…</button> : null}
					</div>
					{dialog === 'suspend' ? (
						<form className="flex flex-col gap-2 border-t border-[var(--g-line)] px-4 py-3" onSubmit={(e) => { e.preventDefault(); void run('/v1/users/suspend', { reason: f.reason?.trim() || undefined }, `${u.username} suspended`); }}>
							<label className="text-[12.5px] text-[var(--g-ink-2)]">Reason (shown to other admins)<input aria-label="Reason" value={f.reason ?? ''} onChange={(e) => set_f({ ...f, reason: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
							<div className="flex gap-2"><button type="submit" disabled={busy} className={G_DANGER}>Suspend</button><button type="button" onClick={() => set_dialog(null)} className={G_BTN}>Cancel</button></div>
						</form>
					) : null}
					{dialog === 'password' ? (
						<form className="flex flex-col gap-2 border-t border-[var(--g-line)] px-4 py-3" onSubmit={(e) => { e.preventDefault(); void run('/v1/users/reset_password', { new_password: f.pw ?? '' }, `Password changed for ${u.username}`); }}>
							<label className="text-[12.5px] text-[var(--g-ink-2)]">New password (8+ characters) — share it with them securely<input aria-label="New password" type="password" autoComplete="new-password" value={f.pw ?? ''} onChange={(e) => set_f({ ...f, pw: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
							<div className="flex gap-2"><button type="submit" disabled={busy || (f.pw ?? '').length < 8} className={G_PRIMARY}>Set password</button><button type="button" onClick={() => set_dialog(null)} className={G_BTN}>Cancel</button></div>
						</form>
					) : null}
					{dialog === 'edit' ? (
						<form className="flex flex-col gap-2 border-t border-[var(--g-line)] px-4 py-3" onSubmit={(e) => { e.preventDefault(); void run('/v1/users/update', { display_name: f.display_name, email: f.email }, 'Profile saved'); }}>
							<label className="text-[12.5px] text-[var(--g-ink-2)]">Display name<input aria-label="Display name" value={f.display_name ?? ''} onChange={(e) => set_f({ ...f, display_name: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
							<label className="text-[12.5px] text-[var(--g-ink-2)]">Email<input aria-label="Email" type="email" value={f.email ?? ''} onChange={(e) => set_f({ ...f, email: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
							<div className="flex gap-2"><button type="submit" disabled={busy} className={G_PRIMARY}>Save</button><button type="button" onClick={() => set_dialog(null)} className={G_BTN}>Cancel</button></div>
						</form>
					) : null}
					{dialog === 'delete' ? (
						<form className="flex flex-col gap-2 border-t border-[var(--g-line)] px-4 py-3" onSubmit={(e) => { e.preventDefault(); void run('/v1/users/delete', {}, `${u.username} deleted`, on_close); }}>
							<p className="text-[12.5px] text-[var(--g-ink-2)]">This permanently deletes <b>{u.username}</b>. Orgs they solely own become ownerless. Type <span className="g-mono">{u.email}</span> to confirm.</p>
							<input aria-label="Confirm email" value={f.confirm ?? ''} onChange={(e) => set_f({ ...f, confirm: e.target.value })} className={`${G_INPUT} w-full`} />
							<div className="flex gap-2"><button type="submit" disabled={busy || f.confirm !== u.email} className={G_DANGER}>Delete account</button><button type="button" onClick={() => set_dialog(null)} className={G_BTN}>Cancel</button></div>
						</form>
					) : null}
					{err ? <p role="alert" className="border-t border-[var(--g-line)] px-4 py-2.5 text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
					<p className="border-t border-[var(--g-line)] px-4 py-2.5 text-[11.5px] text-[var(--g-ink-3)]">Every action here is recorded in the audit log.</p>
				</>
			)}
		</aside>
	);
}

function New_account({ on_close, on_done }: { on_close: () => void; on_done: (id: string | null, msg: string) => void }) {
	const post = use_post();
	const [f, set_f] = useState({ username: '', email: '', display_name: '', password: '' });
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	async function submit(e: FormEvent) {
		e.preventDefault();
		set_busy(true); set_err(null);
		const r = await post('/v1/users/new', { username: f.username.trim(), email: f.email.trim(), password: f.password, ...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}) });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		const id = ((r.data as { user?: { id?: string }; id?: string })?.user?.id ?? (r.data as { id?: string })?.id) ?? null;
		on_done(id, `Account ${f.username.trim()} created`);
	}
	return (
		<form onSubmit={(e) => void submit(e)} aria-label="New account" className="flex flex-col gap-2.5 self-start rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
			<div className="flex items-center justify-between"><b className="text-[14px]">New account</b><button type="button" aria-label="Close" onClick={on_close} className="text-[var(--g-ink-3)]"><X className="h-4 w-4" /></button></div>
			{(['username', 'email', 'display_name'] as const).map((k) => (
				<label key={k} className="text-[12.5px] text-[var(--g-ink-2)]">{k === 'display_name' ? 'Display name (optional)' : k[0].toUpperCase() + k.slice(1)}<input aria-label={k} value={f[k]} onChange={(e) => set_f({ ...f, [k]: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
			))}
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Initial password (8+ characters)<input aria-label="password" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set_f({ ...f, password: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
			{err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
			<button type="submit" disabled={busy || !f.username.trim() || !f.email.trim() || f.password.length < 8} className={`${G_PRIMARY} self-start`}>Create account</button>
		</form>
	);
}

export function Component() {
	const [sp, set_sp] = useSearchParams();
	const filter = (['all', 'admins', 'suspended'].includes(sp.get('filter') ?? '') ? sp.get('filter') : 'all') as Filter;
	const q = sp.get('q') ?? '';
	const offset = Number(sp.get('offset') ?? 0) || 0;
	const selected = sp.get('u');
	const [draft, set_draft] = useState(q);
	const [creating, set_creating] = useState(false);
	const [flash, set_flash] = useState<string | null>(null);
	const read = use_bff_read<Admin_list_data<Admin_account_row>>('/v1/admin_list/get', { kind: 'accounts', filter, ...(q ? { query: q } : {}), limit: LIMIT, offset }, { fallback_error: 'Could not load accounts.' });
	const d = read.data;
	const set = (patch: Record<string, string | null>) => {
		const next = new URLSearchParams(sp);
		for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v); }
		set_sp(next, { replace: true });
	};
	const changed = (msg: string) => { set_flash(msg); void read.reload(); };
	const filters_known = d ? d.counts.admins != null : true;

	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Accounts" sub="Every account on the hub." right={<button type="button" onClick={() => { set_creating(true); set({ u: null }); }} className={G_PRIMARY}><Plus className="h-3.5 w-3.5" /> New account</button>} />
			{flash ? <Banner tone="ok">{flash}</Banner> : null}
			<div className="flex flex-wrap items-center gap-2">
				<Chips<Filter> value={filter} on_change={(k) => set({ filter: k === 'all' ? null : k, offset: null })} options={[
					{ key: 'all', label: 'All', count: d?.counts.all },
					...(filters_known ? [{ key: 'admins' as const, label: 'Site admins', count: d?.counts.admins }, { key: 'suspended' as const, label: 'Suspended', count: d?.counts.suspended, tone: 'bad' as const }] : []),
				]} />
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || null, offset: null }); }}>
					<input aria-label="Search accounts" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Name, username or email" className={`${G_INPUT} w-[260px]`} />
				</form>
			</div>
			{!filters_known ? <p className="text-[12px] text-[var(--g-ink-3)]">“Site admins” / “Suspended” filters appear once Core supports them (API 3).</p> : null}
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="accounts list" /> : null}
			<div className={`grid gap-4 ${selected || creating ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
				<div className={TABLE_WRAP}>
					<table className="w-full text-[13px]">
						<thead><tr className="border-b border-[var(--g-line)]"><th className={TH}>Account</th><th className={TH}>Role</th><th className={TH}>Joined</th><th className={TH}>Status</th></tr></thead>
						<tbody>
							{read.status === 'loading' ? <Empty_row cols={4}>Loading…</Empty_row> : null}
							{d && !d.items.length ? <Empty_row cols={4}>{q ? `No accounts match “${q}”.` : 'No accounts.'}</Empty_row> : null}
							{d?.items.map((u) => (
								<tr key={u.id} onClick={() => { set_creating(false); set({ u: u.id }); }} className={`${TR} cursor-pointer hover:bg-[var(--g-soft)] ${selected === u.id ? 'bg-[var(--g-soft)] shadow-[inset_2px_0_0_var(--g-acc)]' : ''}`} data-testid={`acct-${u.username}`}>
									<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={u.display_name || u.username} /><div className="min-w-0"><b className="font-semibold">{u.display_name || u.username}</b> <span className="g-mono text-[12px] text-[var(--g-ink-3)]">@{u.username}</span><div className="truncate text-[12px] text-[var(--g-ink-3)]">{u.email}</div></div></div></td>
									<td className="px-4">{u.role === 'admin' ? <span className="text-[11.5px] font-bold uppercase tracking-[0.04em] text-[#ff9f5a]">Site admin</span> : <span className="text-[var(--g-ink-3)]">user</span>}</td>
									<td className="px-4 text-[var(--g-ink-3)]">{month_year(u.created_at)}</td>
									<td className="px-4">{u.suspended_at ? <Pill tone="bad">Suspended</Pill> : <Pill tone="ok">Active</Pill>}</td>
								</tr>
							))}
						</tbody>
					</table>
					{d ? <Pager total={d.total} offset={offset} limit={LIMIT} on_change={(o) => set({ offset: o ? String(o) : null })} /> : null}
				</div>
				{creating ? <New_account on_close={() => set_creating(false)} on_done={(id, msg) => { set_creating(false); changed(msg); if (id) set({ u: id }); }} /> : null}
				{selected && !creating ? <Account_panel key={selected} id={selected} on_close={() => set({ u: null })} on_changed={changed} /> : null}
			</div>
		</div>
	);
}
