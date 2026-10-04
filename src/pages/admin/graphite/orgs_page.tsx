/**
 * Admin › Organizations — every customer org, with its status and owner.
 * Read: `POST /v1/orgs/get` (site-admin inventory: status filter, include_deleted).
 * Create: `orgs/new` with an owner picked from `users/get` (search) or invited by email.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, X } from 'lucide-react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { use_bff_read } from '@/lib/use_bff_read';
import { as_deleted_details, as_namespace_holder, month_year, namespace_holder_link, type Admin_org_row, type Deleted_details, type Namespace_holder, type Org_new_data } from '@/lib/admin';
import { day_month, looks_like_email } from '@/lib/invites';
import { Admin_header, Avatar, Chips, Empty_row, Pager, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { G_BTN, G_INPUT, G_PILL, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Org_status_pill, Sent_or_link } from '@/components/graphite/g_invites';
import { Deleted_notice } from '@/components/graphite/g_reactivate';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

const LIMIT = 25;
type Status_filter = 'all' | 'active' | 'waiting_for_owner';
/** A `users/get` row as the owner search uses it. */
interface Found_user { id: string; username: string | null; display_name: string; email: string }
type Owner = { user_id: string; label: string } | { email: string; display_name: string };

/**
 * Searches existing accounts (`users/get` with `query`) as the admin types.
 * `settled` is true once the results belong to the current term.
 */
function use_user_search(term: string, enabled: boolean): { results: Found_user[]; settled: boolean } {
	const auth_fetch = useAuthFetch();
	const [state, set_state] = useState<{ term: string; results: Found_user[] }>({ term: '', results: [] });
	const seq = useRef(0);
	const q = term.trim().replace(/^@+/, '');
	useEffect(() => {
		if (!enabled || q.length < 2) { set_state({ term: q, results: [] }); return; }
		const my = ++seq.current;
		const t = setTimeout(async () => {
			try {
				const res = await auth_fetch('/v1/users/get', { method: 'POST', body: JSON.stringify({ query: q, limit: 8 }) });
				const data = await res.json().catch(() => null);
				if (my === seq.current) set_state({ term: q, results: data?.ok ? (data.data?.users ?? []) : [] });
			} catch { if (my === seq.current) set_state({ term: q, results: [] }); }
		}, 250);
		return () => clearTimeout(t);
	}, [q, enabled, auth_fetch]);
	return { results: state.term === q ? state.results : [], settled: state.term === q };
}

/** What happens next, under the owner box. */
const OWNER_HINT_ACCOUNT = 'They get an email to accept ownership. The org shows as Waiting for owner until they do.';
const OWNER_HINT_EMAIL = 'They get an email to create their account and accept ownership.';
/** Inviting by email never makes a second account for an address that has one. */
const SAME_USER_NOTE = 'If this email already has an account, that same user gets the invite — no new account is created.';

/**
 * Owner box: pick an existing account, or switch to "invite by email" with an optional name.
 * An email that matches an account found by the search offers only that account.
 */
function Owner_picker({ owner, on_change }: { owner: Owner | null; on_change: (o: Owner | null) => void }) {
	const [q, set_q] = useState('');
	const by_email = owner != null && 'email' in owner;
	const { results, settled } = use_user_search(q, owner == null);
	if (by_email) {
		return (
			<div className="flex w-full flex-wrap items-end gap-3" role="group" aria-label="Owner · invite someone new">
				<label className="text-[12.5px] text-[var(--g-ink-2)]">Owner email<input aria-label="Owner email" type="email" value={owner.email} onChange={(e) => on_change({ ...owner, email: e.target.value })} className={`${G_INPUT} mt-1 block w-[240px]`} /></label>
				<label className="text-[12.5px] text-[var(--g-ink-2)]">Name (if new)<input aria-label="Owner name" value={owner.display_name} onChange={(e) => on_change({ ...owner, display_name: e.target.value })} className={`${G_INPUT} mt-1 block w-[200px]`} /></label>
				<button type="button" onClick={() => on_change(null)} className={G_BTN}>Search accounts instead</button>
				<p className="w-full text-[11.5px] text-[var(--g-ink-3)]">{OWNER_HINT_EMAIL} <span data-testid="same-user-note">{SAME_USER_NOTE}</span></p>
			</div>
		);
	}
	if (owner) {
		return (
			<div className="flex flex-col gap-1">
				<div className="flex items-end gap-2">
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Owner<input aria-label="Owner" readOnly value={owner.label} className={`${G_INPUT} mt-1 block w-[240px]`} /></label>
					<button type="button" onClick={() => on_change(null)} className={G_BTN}>Change</button>
				</div>
				<p className="max-w-[360px] text-[11.5px] text-[var(--g-ink-3)]">{OWNER_HINT_ACCOUNT}</p>
			</div>
		);
	}
	const email = looks_like_email(q) ? q.trim() : '';
	// The typed address already has an account: pick that account, never a second invite path.
	const has_account = email !== '' && results.some((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
	return (
		<div className="relative">
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Owner<input aria-label="Owner" role="combobox" aria-expanded={results.length > 0 || Boolean(q.trim())} aria-controls="owner-options" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Username or email" className={`${G_INPUT} mt-1 block w-[240px]`} /></label>
			{q.trim().length >= 2 ? (
				<ul id="owner-options" role="listbox" aria-label="Owner options" className="absolute z-10 mt-1 w-[320px] overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] shadow-lg">
					{results.map((u) => (
						<li key={u.id} role="option" aria-selected={false}>
							<button type="button" onClick={() => on_change({ user_id: u.id, label: u.username ? (u.display_name ? `${u.display_name} (@${u.username})` : `@${u.username}`) : u.email })} className="flex w-full flex-col px-3 py-2 text-left text-[13px] hover:bg-[var(--g-soft)]">
								<b>{u.username ?? u.email}</b><span className="text-[12px] text-[var(--g-ink-3)]">{u.username ? u.email : 'Invited, no account yet'}{has_account && (u.email ?? '').toLowerCase() === email.toLowerCase() ? ' · has an account with this email' : ''}</span>
							</button>
						</li>
					))}
					{!settled ? <li className="px-3 py-2 text-[12.5px] text-[var(--g-ink-3)]">Searching accounts…</li> : null}
					{!settled || has_account ? null : <li role="option" aria-selected={false}>
						<button type="button" title={SAME_USER_NOTE} onClick={() => on_change({ email, display_name: '' })} className="w-full border-t border-[var(--g-line)] px-3 py-2 text-left text-[13px] font-semibold text-[var(--g-acc)] hover:bg-[var(--g-soft)]">
							+ {email ? `Invite ${email} by email` : 'Invite someone new by email'}
						</button>
					</li>}
				</ul>
			) : null}
		</div>
	);
}

function New_org({ on_close, on_created }: { on_close: () => void; on_created: () => void }) {
	const post = use_post();
	const [f, set_f] = useState({ slug: '', display_name: '' });
	const [owner, set_owner] = useState<Owner | null>(null);
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	// Name conflicts say who holds the name; link there so the admin can fix or reuse it.
	const [holder, set_holder] = useState<Namespace_holder | null>(null);
	const [deleted, set_deleted] = useState<{ details: Deleted_details | null } | null>(null);
	const [done, set_done] = useState<Org_new_data | null>(null);
	const owner_ok = owner != null && ('user_id' in owner || looks_like_email(owner.email));

	async function create(reactivate: boolean) {
		if (!owner) return;
		set_busy(true); set_err(null); set_holder(null); set_deleted(null);
		const owner_body = 'user_id' in owner
			? { user_id: owner.user_id }
			: { email: owner.email.trim(), ...(owner.display_name.trim() ? { display_name: owner.display_name.trim() } : {}) };
		const r = await post('/v1/orgs/new', {
			slug: f.slug.trim(),
			...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}),
			owner: owner_body,
			...(reactivate ? { reactivate: true } : {}),
		});
		set_busy(false);
		if (!r.ok) {
			if (r.code === 'deleted') { set_deleted({ details: as_deleted_details(r.details) }); return; }
			set_err(r.error); set_holder(as_namespace_holder(r.details)); return;
		}
		set_done(r.data as Org_new_data);
		on_created();
	}
	function submit(e: FormEvent) { e.preventDefault(); void create(false); }

	if (done) {
		const inv = done.owner_invite;
		return (
			<section aria-label="New organization" className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" data-testid="org-created">
				<div className="flex items-center gap-2"><b className="text-[14px]">{done.org.display_name || done.org.slug}</b><Org_status_pill status={done.org.status} /></div>
				<Sent_or_link email_sent={inv.email_sent} url={inv.invite_url} sent={<>Owner invite sent to <b>{done.org.owner.email}</b>{done.org.owner.status === 'invited' ? ' (no account yet)' : ' (existing account)'}. </>}>
					<span className="text-[var(--g-ink-2)]">{done.org.reactivated ? 'The org is back with its history. ' : ''}It shows as Waiting for owner until they accept · expires {day_month(inv.expires_at)}.</span>
				</Sent_or_link>
				<div className="flex gap-2">
					<Link to={`/admin/orgs/${done.org.id}`} className={G_PRIMARY}>Open org</Link>
					<button type="button" onClick={on_close} className={G_BTN}>Done</button>
				</div>
			</section>
		);
	}

	return (
		<form onSubmit={submit} aria-label="New organization" className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Name<input aria-label="Name" value={f.slug} onChange={(e) => set_f({ ...f, slug: e.target.value })} placeholder="acme" className={`${G_INPUT} mt-1 block w-[180px]`} /></label>
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Display name<input aria-label="Display name" value={f.display_name} onChange={(e) => set_f({ ...f, display_name: e.target.value })} placeholder="Acme Inc." className={`${G_INPUT} mt-1 block w-[200px]`} /></label>
			<Owner_picker owner={owner} on_change={set_owner} />
			<button type="submit" disabled={busy || !f.slug.trim() || !owner_ok} className={G_PRIMARY}>Create org and invite owner</button>
			<button type="button" aria-label="Close" onClick={on_close} className="ml-auto self-start text-[var(--g-ink-3)]"><X className="h-4 w-4" /></button>
			{deleted ? <Deleted_notice name={deleted.details?.kind === 'user' && owner && 'email' in owner ? owner.email.trim() : f.slug.trim()} details={deleted.details} busy={busy} on_reactivate={() => void create(true)} on_cancel={() => set_deleted(null)} /> : null}
			{err ? (
				<p role="alert" className="w-full text-[12.5px] text-[var(--g-bad)]">
					{err}
					{holder ? (() => { const link = namespace_holder_link(holder); return <> <Link to={link.href} className="ml-1 font-semibold text-[var(--g-acc)] hover:underline" data-testid="name-holder-link">{link.label} →</Link></>; })() : null}
				</p>
			) : null}
		</form>
	);
}

export function Component() {
	const navigate = useNavigate();
	const { user } = useAuth();
	const [sp, set_sp] = useSearchParams();
	const q = sp.get('q') ?? '';
	const offset = Number(sp.get('offset') ?? 0) || 0;
	const include_deleted = sp.get('deleted') === '1';
	const status = (['active', 'waiting_for_owner'].includes(sp.get('status') ?? '') ? sp.get('status') : 'all') as Status_filter;
	const site_admin = user?.role === 'admin';
	const [draft, set_draft] = useState(q);
	const [creating, set_creating] = useState(false);
	// Core can't sort orgs yet: the BFF answers `sortable: []` until it can, so these headers stay plain.
	const sort = use_table_sort({ keys: ['slug', 'display_name', 'member_count', 'scope_count', 'created_at'], default_sort: { by: 'created_at', dir: 'desc' }, first_dir: { created_at: 'desc', member_count: 'desc', scope_count: 'desc' } });
	const read = use_bff_read<{ orgs: Admin_org_row[]; total: number; sortable: string[] }>('/v1/orgs/get', {
		limit: LIMIT, offset, ...sort.body,
		...(q ? { query: q } : {}),
		...(status !== 'all' ? { status } : {}),
		...(include_deleted && site_admin ? { include_deleted: true } : {}),
	}, { fallback_error: 'Could not load organizations.' });
	const cols = sort.with_sortable(read.data?.sortable);
	const d = read.data;
	const set = (patch: Record<string, string | null>) => {
		const n = new URLSearchParams(sp);
		for (const [k, v] of Object.entries(patch)) { if (!v) n.delete(k); else n.set(k, v); }
		set_sp(n, { replace: true });
	};

	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Organizations" sub="Every customer org on the hub." right={<button type="button" onClick={() => set_creating(true)} className={G_PRIMARY}><Plus className="h-3.5 w-3.5" /> New org</button>} />
			{creating ? <New_org on_close={() => set_creating(false)} on_created={() => void read.reload()} /> : null}
			<div className="flex flex-wrap items-center gap-2">
				<Chips<Status_filter> label="Status" value={status} on_change={(k) => set({ status: k === 'all' ? null : k, offset: null })} options={[
					{ key: 'all', label: 'All' },
					{ key: 'active', label: 'Active' },
					{ key: 'waiting_for_owner', label: 'Waiting for owner', tone: 'warn' },
				]} />
				{site_admin ? <button type="button" aria-pressed={include_deleted} onClick={() => set({ deleted: include_deleted ? null : '1', offset: null })} className={G_PILL(include_deleted)}>Include deleted</button> : null}
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || null, offset: null }); }}>
					<input aria-label="Search organizations" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Slug or name" className={`${G_INPUT} w-[240px]`} />
				</form>
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="organizations list" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="slug" className={TH}>Organization</Sort_th><th className={TH}>Status</th><th className={TH}>Owner</th><Sort_th sort={cols} k="member_count" className={TH}>Members</Sort_th><Sort_th sort={cols} k="scope_count" className={TH}>Scopes</Sort_th><Sort_th sort={cols} k="created_at" className={TH}>Created</Sort_th><th className={TH} /></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={7}>Loading…</Empty_row> : null}
						{d && !d.orgs.length ? <Empty_row cols={7}>{q ? `No orgs match “${q}”.` : 'No organizations.'}</Empty_row> : null}
						{d?.orgs.map((o) => (
							<tr key={o.id} onClick={() => navigate(`/admin/orgs/${o.id}`)} className={`${TR} cursor-pointer hover:bg-[var(--g-soft)] ${o.deleted_at ? 'opacity-60' : ''}`} data-testid={`org-${o.slug}`}>
								<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={o.display_name || o.slug} /><div><b>{o.display_name || o.slug}</b> <span className="g-mono text-[12px] text-[var(--g-ink-3)]">{o.slug}</span></div></div></td>
								<td className="px-4"><Org_status_pill status={o.deleted_at ? 'deleted' : o.status} /></td>
								<td className="px-4 text-[var(--g-ink-2)]">{!o.owner ? <span className="text-[var(--g-ink-3)]">—</span> : !o.owner.username ? <span className="text-[var(--g-ink-3)]">Invited</span> : <>{o.owner.username}{o.owner.status === 'invited' ? <span className="text-[var(--g-ink-3)]"> · invited</span> : null}</>}</td>
								<td className="g-mono px-4">{o.member_count}</td>
								<td className="g-mono px-4">{o.scope_count}</td>
								<td className="px-4 text-[var(--g-ink-3)]">{month_year(o.created_at)}</td>
								<td className="px-4 text-right text-[var(--g-ink-3)]">›</td>
							</tr>
						))}
					</tbody>
				</table>
				{d ? <Pager total={d.total} offset={offset} limit={LIMIT} on_change={(o) => set({ offset: o ? String(o) : null })} /> : null}
			</div>
		</div>
	);
}
