/**
 * Admin › Accounts (AD2) — every account on the hub, with a side panel.
 * Read: `POST /v1/admin_list/get {kind:'accounts'}` (rows + chip counts;
 *       `include_deleted` behind the "Include deleted" toggle);
 *       `POST /v1/users/get_by_id` for the selected account.
 * Writes: users/suspend · unsuspend · set_role · reset_password (sends a reset email) · update · delete ·
 *         new (no password: the person gets a "Set your password" email; with
 *         `reactivate: true` it restores a deleted account, the only action a deleted account offers);
 *         act-as via session/update (auth context).
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, X } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, as_deleted_details, handle, login_name, month_year, person_name, type Admin_account_row, type Admin_list_data, type Admin_user_detail, type Deleted_details, type Reset_email_data, type Users_new_data } from '@/lib/admin';
import { day_month } from '@/lib/invites';
import { Admin_header, Avatar, Banner, Chips, Empty_row, Pager, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { Account_status_pill, Sent_or_link } from '@/components/graphite/g_invites';
import { Deleted_notice } from '@/components/graphite/g_reactivate';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { G_BTN, G_INPUT, G_PILL, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Filter = 'all' | 'admins' | 'suspended';
const LIMIT = 25;
const G_DANGER = 'inline-flex items-center whitespace-nowrap rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] disabled:opacity-40';

type Dialog = null | 'suspend' | 'edit' | 'delete';

/** Core's message when `users/new` refused the username (422 `details.field: 'username'`), else null. */
function username_refusal(r: { ok: false; error: string; code: string | null; details: Record<string, unknown> | null }): string | null {
	return r.code === 'invalid_params' && r.details?.field === 'username' ? r.error : null;
}

/**
 * A deleted account's only action: `users/new` with `reactivate: true` restores
 * it (same id and history) and sends a new "Set your password" email. Someone
 * deleted before choosing a username is given one here.
 */
function Reactivate_account({ u, on_done }: { u: Admin_user_detail; on_done: (data: Users_new_data) => void }) {
	const post = use_post();
	const [username, set_username] = useState(u.username ?? '');
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const [username_err, set_username_err] = useState<string | null>(null);
	async function reactivate(e: FormEvent) {
		e.preventDefault();
		set_busy(true); set_err(null); set_username_err(null);
		const r = await post('/v1/users/new', { username: username.trim(), email: u.email, ...(u.display_name ? { display_name: u.display_name } : {}), reactivate: true });
		set_busy(false);
		if (!r.ok) {
			const refused = username_refusal(r);
			if (refused) set_username_err(refused); else set_err(r.error);
			return;
		}
		on_done(r.data as Users_new_data);
	}
	return (
		<form onSubmit={(e) => void reactivate(e)} aria-label="Reactivate account" className="flex flex-col gap-2 border-b border-[var(--g-line)] bg-[var(--g-soft)] px-4 py-3 text-[12.5px]">
			<p><b>{u.deleted_at ? `Deleted ${ago(u.deleted_at)} ago` : 'Deleted'}</b><span className="text-[var(--g-ink-2)]"> — reactivating restores the same account and history and sends a new “Set your password” email.</span></p>
			{u.username && !username_err ? null : <label className="text-[var(--g-ink-2)]">Username<input aria-label="Username" value={username} onChange={(e) => { set_username(e.target.value); set_username_err(null); }} aria-invalid={Boolean(username_err) || undefined} aria-describedby={username_err ? 'reactivate-username-error' : undefined} className={`${G_INPUT} mt-1 w-full`} /></label>}
			{username_err ? <p id="reactivate-username-error" role="alert" className="text-[var(--g-bad)]">{username_err}</p> : null}
			{err ? <p role="alert" className="text-[var(--g-bad)]">{err}</p> : null}
			<button type="submit" disabled={busy || !username.trim()} className={`${G_PRIMARY} self-start`}>Reactivate</button>
		</form>
	);
}

function Account_panel({ id, on_close, on_changed }: { id: string; on_close: () => void; on_changed: (msg: string) => void }) {
	const { user: me, act_as } = useAuth();
	const navigate = useNavigate();
	const post = use_post();
	const read = use_bff_read<Admin_user_detail>('/v1/users/get_by_id', { user_id: id }, { fallback_error: 'Could not load the account.' });
	const [dialog, set_dialog] = useState<Dialog>(null);
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const [f, set_f] = useState<Record<string, string>>({});
	const [reset, set_reset] = useState<Reset_email_data | null>(null);
	const [owned, set_owned] = useState<string[]>([]);
	const [reactivated, set_reactivated] = useState<Users_new_data | null>(null);
	const u = read.data;
	const is_me = me?.id === id;
	const deleted = u ? u.status === 'deleted' || u.deleted_at != null : false;
	const name = u ? person_name(u) : '';
	const who = u ? login_name(u) : '';

	async function run(path: string, body: Record<string, unknown>, msg: string, after?: () => void) {
		set_busy(true); set_err(null); set_owned([]);
		const r = await post(path, { user_id: id, ...body });
		set_busy(false);
		if (!r.ok) {
			if (r.code === 'owns_orgs') set_owned(((r.details?.orgs ?? []) as Array<{ slug: string }>).map((o) => o.slug));
			set_err(r.error);
			return;
		}
		set_dialog(null); set_f({});
		await read.reload();
		on_changed(msg);
		after?.();
	}

	/** `users/reset_password {user_id}`: emails a reset link (or returns it when email can't send). */
	async function send_reset() {
		set_busy(true); set_err(null); set_reset(null);
		const r = await post('/v1/users/reset_password', { user_id: id });
		set_busy(false);
		if (!r.ok) { set_err(r.code === 'not_active' ? 'Unsuspend the user first.' : r.error); return; }
		set_reset(r.data as Reset_email_data);
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
							<div className="flex flex-wrap items-center gap-2"><b className="text-[15px]">{name}</b><Account_status_pill status={deleted ? 'deleted' : u.status} />{u.role === 'admin' ? <Pill tone="warn">Site admin</Pill> : null}</div>
							<p className="truncate text-[12.5px] text-[var(--g-ink-3)]">{u.email} · {handle(u.username)} · joined {month_year(u.created_at)}</p>
						</div>
						<button type="button" aria-label="Close" onClick={on_close} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
					</div>
					{deleted ? <Reactivate_account u={u} on_done={(d) => { set_reactivated(d); void read.reload(); on_changed(`${d.user.username} reactivated`); }} /> : null}
					{reactivated ? (
						<div className="border-b border-[var(--g-line)] px-4 py-3" data-testid="account-reactivated">
							<Sent_or_link email_sent={reactivated.setup.email_sent} url={reactivated.setup.setup_url} sent={<>Reactivated. Set-password email sent to <b>{reactivated.user.email}</b>. The link works until {day_month(reactivated.setup.expires_at)}.</>} />
						</div>
					) : null}
					{!deleted && u.status === 'suspended' ? (
						<div className="border-b border-[var(--g-line)] bg-[var(--g-bad-soft)] px-4 py-3 text-[12.5px]">
							<b className="text-[var(--g-bad)]">{u.suspended_at ? `Suspended ${ago(u.suspended_at)} ago` : 'Suspended'}</b>{u.suspended_reason ? <span className="text-[var(--g-ink-2)]"> — {u.suspended_reason}</span> : null}
							<div className="mt-2"><button type="button" disabled={busy} onClick={() => void run('/v1/users/unsuspend', {}, `${who} unsuspended`)} className={G_BTN}>Unsuspend</button></div>
						</div>
					) : null}
					<div className="border-b border-[var(--g-line)] px-4 py-3">
						<div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Organizations</div>
						{u.orgs.length ? u.orgs.map((o) => (
							<div key={o.id} className="flex justify-between py-0.5 text-[13px]"><Link to={`/admin/orgs/${o.id}`} className="hover:underline">{o.display_name || o.slug}</Link><span className="text-[var(--g-ink-3)]">{o.role}</span></div>
						)) : <p className="text-[12.5px] text-[var(--g-ink-3)]">Not in any org.</p>}
					</div>
					<div className="border-b border-[var(--g-line)] px-4 py-3 text-[12.5px] text-[var(--g-ink-2)]">
						<div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Owns</div>
						{[[u.team_count, 'team'], [u.scope_count, 'scope'], [u.token_count, 'access token'], [u.draft_count, 'draft']].map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`).join(' · ')}
					</div>
					{deleted ? null : <div className="flex flex-wrap gap-2 px-4 py-3">
						{!is_me ? <button type="button" disabled={busy || u.status === 'suspended'} onClick={() => void take_over()} className={G_BTN}>Act as {who}</button> : null}
						{!is_me ? <button type="button" disabled={busy} onClick={() => void run('/v1/users/set_role', { role: u.role === 'admin' ? 'user' : 'admin' }, u.role === 'admin' ? `${who} is no longer a site admin` : `${who} is now a site admin`)} className={G_BTN}>{u.role === 'admin' ? 'Remove site admin' : 'Make site admin'}</button> : null}
						<button type="button" onClick={() => { set_f({ display_name: u.display_name, email: u.email }); set_dialog('edit'); }} className={G_BTN}>Edit profile</button>
						<button type="button" disabled={busy} onClick={() => void send_reset()} className={G_BTN}>Send reset email</button>
						{!is_me && u.status !== 'suspended' ? <button type="button" onClick={() => set_dialog('suspend')} className={G_BTN}>Suspend…</button> : null}
						{!is_me ? <button type="button" onClick={() => set_dialog('delete')} className={G_DANGER}>Delete account…</button> : null}
					</div>}
					{dialog === 'suspend' ? (
						<form className="flex flex-col gap-2 border-t border-[var(--g-line)] px-4 py-3" onSubmit={(e) => { e.preventDefault(); void run('/v1/users/suspend', { reason: f.reason?.trim() || undefined }, `${who} suspended`); }}>
							<label className="text-[12.5px] text-[var(--g-ink-2)]">Reason (shown to other admins)<input aria-label="Reason" value={f.reason ?? ''} onChange={(e) => set_f({ ...f, reason: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
							<div className="flex gap-2"><button type="submit" disabled={busy} className={G_DANGER}>Suspend</button><button type="button" onClick={() => set_dialog(null)} className={G_BTN}>Cancel</button></div>
						</form>
					) : null}
					{reset ? (
						<div className="border-t border-[var(--g-line)] px-4 py-3">
							<Sent_or_link email_sent={reset.email_sent} url={reset.reset_url} sent={<>Reset email sent to <b>{u.email}</b>. The link works until {day_month(reset.expires_at)}.</>} />
						</div>
					) : null}
					{dialog === 'edit' ? (
						<form className="flex flex-col gap-2 border-t border-[var(--g-line)] px-4 py-3" onSubmit={(e) => { e.preventDefault(); void run('/v1/users/update', { display_name: f.display_name, email: f.email }, 'Profile saved'); }}>
							<label className="text-[12.5px] text-[var(--g-ink-2)]">Display name<input aria-label="Display name" value={f.display_name ?? ''} onChange={(e) => set_f({ ...f, display_name: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
							<label className="text-[12.5px] text-[var(--g-ink-2)]">Email<input aria-label="Email" type="email" value={f.email ?? ''} onChange={(e) => set_f({ ...f, email: e.target.value })} className={`${G_INPUT} mt-1 w-full`} /></label>
							<div className="flex gap-2"><button type="submit" disabled={busy} className={G_PRIMARY}>Save</button><button type="button" onClick={() => set_dialog(null)} className={G_BTN}>Cancel</button></div>
						</form>
					) : null}
					{dialog === 'delete' ? (
						<form className="flex flex-col gap-2 border-t border-[var(--g-line)] px-4 py-3" onSubmit={(e) => { e.preventDefault(); void run('/v1/users/delete', {}, `${who} deleted`, on_close); }}>
							<p className="text-[12.5px] text-[var(--g-ink-2)]">Deletes <b>{who}</b>. Their history is kept and the username and email stay taken. Type <span className="g-mono">{u.email}</span> to confirm.</p>
							<input aria-label="Confirm email" value={f.confirm ?? ''} onChange={(e) => set_f({ ...f, confirm: e.target.value })} className={`${G_INPUT} w-full`} />
							<div className="flex gap-2"><button type="submit" disabled={busy || f.confirm !== u.email} className={G_DANGER}>Delete account</button><button type="button" onClick={() => set_dialog(null)} className={G_BTN}>Cancel</button></div>
						</form>
					) : null}
					{err ? (
						<div role="alert" className="border-t border-[var(--g-line)] px-4 py-2.5 text-[12.5px] text-[var(--g-bad)]">
							{err}
							{owned.length ? <ul className="mt-1 list-disc pl-5" data-testid="owned-orgs">{owned.map((slug) => <li key={slug}><Link to={`/admin/orgs?q=${encodeURIComponent(slug)}`} className="hover:underline">{slug}</Link></li>)}</ul> : null}
						</div>
					) : null}
					<p className="border-t border-[var(--g-line)] px-4 py-2.5 text-[11.5px] text-[var(--g-ink-3)]">Every action here is recorded in the audit log.</p>
				</>
			)}
		</aside>
	);
}

function New_account({ on_close, on_done }: { on_close: () => void; on_done: (msg: string) => void }) {
	const post = use_post();
	const [f, set_f] = useState({ username: '', email: '', display_name: '' });
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const [username_err, set_username_err] = useState<string | null>(null);
	const [deleted, set_deleted] = useState<{ details: Deleted_details | null } | null>(null);
	const [created, set_created] = useState<Users_new_data | null>(null);
	async function create(reactivate: boolean) {
		set_busy(true); set_err(null); set_username_err(null); set_deleted(null);
		const r = await post('/v1/users/new', { username: f.username.trim(), email: f.email.trim(), ...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}), ...(reactivate ? { reactivate: true } : {}) });
		set_busy(false);
		if (!r.ok) {
			const refused = username_refusal(r);
			if (r.code === 'deleted') set_deleted({ details: as_deleted_details(r.details) });
			else if (refused) set_username_err(refused);
			else set_err(r.error);
			return;
		}
		const d = r.data as Users_new_data;
		set_created(d);
		on_done(`Account ${d.user.username} created`);
	}
	function submit(e: FormEvent) { e.preventDefault(); void create(false); }
	if (created) {
		return (
			<section aria-label="New account" className="flex flex-col gap-2.5 self-start rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" data-testid="account-created">
				<div className="flex items-center justify-between"><b className="text-[14px]">{created.user.username}</b><Account_status_pill status={created.user.status} /></div>
				<Sent_or_link email_sent={created.setup.email_sent} url={created.setup.setup_url} sent={<>Set-password email sent to <b>{created.user.email}</b>. The link works until {day_month(created.setup.expires_at)}.</>} />
				<button type="button" onClick={on_close} className={`${G_BTN} self-start`}>Done</button>
			</section>
		);
	}
	return (
		<form onSubmit={submit} aria-label="New account" className="flex flex-col gap-2.5 self-start rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
			<div className="flex items-center justify-between"><b className="text-[14px]">New account</b><button type="button" aria-label="Close" onClick={on_close} className="text-[var(--g-ink-3)]"><X className="h-4 w-4" /></button></div>
			{(['username', 'email', 'display_name'] as const).map((k) => (
				<label key={k} className="text-[12.5px] text-[var(--g-ink-2)]">{k === 'display_name' ? 'Display name (optional)' : k[0].toUpperCase() + k.slice(1)}<input aria-label={k} value={f[k]} onChange={(e) => { set_f({ ...f, [k]: e.target.value }); if (k === 'username') set_username_err(null); }} aria-invalid={(k === 'username' && Boolean(username_err)) || undefined} aria-describedby={k === 'username' && username_err ? 'new-username-error' : undefined} className={`${G_INPUT} mt-1 w-full`} />
					{k === 'username' && username_err ? <span id="new-username-error" role="alert" className="mt-1 block text-[12px] text-[var(--g-bad)]">{username_err}</span> : null}
				</label>
			))}
			<p className="text-[12px] text-[var(--g-ink-3)]">They get an email to set their own password.</p>
			{deleted ? <Deleted_notice name={f.email.trim() || f.username.trim()} details={deleted.details} busy={busy} on_reactivate={() => void create(true)} on_cancel={() => set_deleted(null)} /> : null}
			{err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
			<button type="submit" disabled={busy || !f.username.trim() || !f.email.trim()} className={`${G_PRIMARY} self-start`}>Create account</button>
		</form>
	);
}

export function Component() {
	const [sp, set_sp] = useSearchParams();
	const filter = (['all', 'admins', 'suspended'].includes(sp.get('filter') ?? '') ? sp.get('filter') : 'all') as Filter;
	const q = sp.get('q') ?? '';
	const offset = Number(sp.get('offset') ?? 0) || 0;
	const selected = sp.get('u');
	const { user } = useAuth();
	const site_admin = user?.role === 'admin';
	const include_deleted = site_admin && sp.get('deleted') === '1';
	const [draft, set_draft] = useState(q);
	const [creating, set_creating] = useState(false);
	const [flash, set_flash] = useState<string | null>(null);
	const sort = use_table_sort({ keys: ['username', 'role', 'created_at', 'suspended_at'], default_sort: { by: 'created_at', dir: 'desc' }, first_dir: { created_at: 'desc' } });
	const read = use_bff_read<Admin_list_data<Admin_account_row>>('/v1/admin_list/get', { kind: 'accounts', filter, ...(include_deleted ? { include_deleted: true } : {}), ...sort.body, ...(q ? { query: q } : {}), limit: LIMIT, offset }, { fallback_error: 'Could not load accounts.' });
	const cols = sort.with_sortable(read.data?.sortable);
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
				{site_admin ? <button type="button" aria-pressed={include_deleted} onClick={() => set({ deleted: include_deleted ? null : '1', offset: null })} className={G_PILL(include_deleted)}>Include deleted</button> : null}
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || null, offset: null }); }}>
					<input aria-label="Search accounts" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Name, username or email" className={`${G_INPUT} w-[260px]`} />
				</form>
			</div>
			{!filters_known ? <p className="text-[12px] text-[var(--g-ink-3)]">“Site admins” / “Suspended” filters appear once Core supports them (API 3).</p> : null}
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="accounts list" /> : null}
			<div className={`grid gap-4 ${selected || creating ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
				<div className={TABLE_WRAP}>
					<table className="w-full text-[13px]">
						<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="username" className={TH}>Account</Sort_th><Sort_th sort={cols} k="role" className={TH}>Role</Sort_th><Sort_th sort={cols} k="created_at" className={TH}>Joined</Sort_th><Sort_th sort={cols} k="suspended_at" className={TH}>Status</Sort_th></tr></thead>
						<tbody>
							{read.status === 'loading' ? <Empty_row cols={4}>Loading…</Empty_row> : null}
							{d && !d.items.length ? <Empty_row cols={4}>{q ? `No accounts match “${q}”.` : 'No accounts.'}</Empty_row> : null}
							{d?.items.map((u) => (
								<tr key={u.id} onClick={() => { set_creating(false); set({ u: u.id }); }} className={`${TR} cursor-pointer hover:bg-[var(--g-soft)] ${u.deleted_at ? 'opacity-60' : ''} ${selected === u.id ? 'bg-[var(--g-soft)] shadow-[inset_2px_0_0_var(--g-acc)]' : ''}`} data-testid={`acct-${u.username ?? u.id}`}>
									<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={person_name(u)} /><div className="min-w-0"><b className="font-semibold">{person_name(u)}</b> <span className="g-mono text-[12px] text-[var(--g-ink-3)]">{handle(u.username)}</span><div className="truncate text-[12px] text-[var(--g-ink-3)]">{u.email}</div></div></div></td>
									<td className="px-4">{u.role === 'admin' ? <span className="text-[11.5px] font-bold uppercase tracking-[0.04em] text-[var(--g-orange)]">Site admin</span> : <span className="text-[var(--g-ink-3)]">user</span>}</td>
									<td className="px-4 text-[var(--g-ink-3)]">{month_year(u.created_at)}</td>
									<td className="px-4"><Account_status_pill status={u.deleted_at ? 'deleted' : u.status} /></td>
								</tr>
							))}
						</tbody>
					</table>
					{d ? <Pager total={d.total} offset={offset} limit={LIMIT} on_change={(o) => set({ offset: o ? String(o) : null })} /> : null}
				</div>
				{creating ? <New_account on_close={() => set_creating(false)} on_done={changed} /> : null}
				{selected && !creating ? <Account_panel key={selected} id={selected} on_close={() => set({ u: null })} on_changed={changed} /> : null}
			</div>
		</div>
	);
}
