/**
 * Admin › Catalog › Scopes — who owns each publishing namespace (@scope/…).
 * Read: `POST /v1/admin_list/get {kind:'scopes'}` (→ orgs/get_scopes, site-admin catalog).
 * Writes (org scopes): orgs/new_scope · orgs/update_scope · orgs/delete_scope.
 */
import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { use_bff_read } from '@/lib/use_bff_read';
import { month_year, type Admin_list_data, type Admin_scope_row } from '@/lib/admin';
import { Admin_header, Banner, Empty_row, Pager, Pill, TABLE_WRAP, TH, TR, use_list_params } from '@/components/graphite/g_admin';
import { Org_filter } from '@/components/graphite/g_lookup';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

const LIMIT = 25;
const G_DANGER = 'inline-flex items-center whitespace-nowrap rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] disabled:opacity-40';
function New_scope({ on_close, on_done }: { on_close: () => void; on_done: (msg: string) => void }) {
	const post = use_post();
	const [f, set_f] = useState({ org_id: '', slug: '', display_name: '', visibility: 'private' });
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	async function submit(e: FormEvent) {
		e.preventDefault();
		set_busy(true); set_err(null);
		const r = await post('/v1/orgs/new_scope', { org_id: f.org_id, slug: f.slug.trim(), visibility: f.visibility, ...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}) });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		on_done(`@${f.slug.trim()} created`);
	}
	return (
		<form onSubmit={(e) => void submit(e)} aria-label="New scope" className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Org<div className="mt-1"><Org_filter value={f.org_id} on_change={(v) => set_f({ ...f, org_id: v })} all_label="Pick an org…" /></div></label>
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Slug<input aria-label="Slug" value={f.slug} onChange={(e) => set_f({ ...f, slug: e.target.value })} placeholder="acme-data" className={`${G_INPUT} mt-1 block w-[170px]`} /></label>
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Name<input aria-label="Name" value={f.display_name} onChange={(e) => set_f({ ...f, display_name: e.target.value })} className={`${G_INPUT} mt-1 block w-[180px]`} /></label>
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Visibility<select aria-label="Visibility" value={f.visibility} onChange={(e) => set_f({ ...f, visibility: e.target.value })} className={`${G_INPUT} mt-1 block w-[120px]`}><option value="private">private</option><option value="public">public</option></select></label>
			<button type="submit" disabled={busy || !f.org_id || !/^[a-z][a-z0-9-]*$/.test(f.slug.trim())} className={G_PRIMARY}>Create scope</button>
			<button type="button" aria-label="Close" onClick={on_close} className="ml-auto self-start text-[var(--g-ink-3)]"><X className="h-4 w-4" /></button>
			{err ? <p role="alert" className="w-full text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
		</form>
	);
}

function Scope_editor({ s, on_close, on_done }: { s: Admin_scope_row; on_close: () => void; on_done: (msg: string) => void }) {
	const post = use_post();
	const [name, set_name] = useState(s.display_name);
	const [vis, set_vis] = useState(s.visibility);
	const [confirm, set_confirm] = useState('');
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	async function run(path: string, body: Record<string, unknown>, msg: string) {
		set_busy(true); set_err(null);
		const r = await post(path, { org_id: s.org_id, scope_id: s.id, ...body });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		on_done(msg);
	}
	return (
		<aside aria-label="Scope" className="flex flex-col gap-3 self-start rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" data-testid="scope-panel">
			<div className="flex items-center justify-between"><b className="g-mono text-[14px]">@{s.slug}</b><button type="button" aria-label="Close" onClick={on_close} className="text-[var(--g-ink-3)]"><X className="h-4 w-4" /></button></div>
			<p className="text-[12.5px] text-[var(--g-ink-3)]">{s.org_slug ? `Org ${s.org_slug}` : 'Personal scope'} · {s.team_count} team{s.team_count === 1 ? '' : 's'} · owner {s.owner_username ?? '—'}</p>
			{s.org_id ? (
				<>
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Display name<input aria-label="Display name" value={name} onChange={(e) => set_name(e.target.value)} className={`${G_INPUT} mt-1 w-full`} /></label>
					<label className="text-[12.5px] text-[var(--g-ink-2)]">Visibility<select aria-label="Visibility" value={vis} onChange={(e) => set_vis(e.target.value)} className={`${G_INPUT} mt-1 w-full`}><option value="private">private</option><option value="public">public</option></select></label>
					<button type="button" disabled={busy || (name === s.display_name && vis === s.visibility)} onClick={() => void run('/v1/orgs/update_scope', { display_name: name, visibility: vis }, `@${s.slug} saved`)} className={`${G_PRIMARY} self-start`}>Save</button>
					<div className="mt-2 flex flex-col gap-2 border-t border-[var(--g-line)] pt-3">
						{s.team_count ? (
							<p className="text-[12.5px] text-[var(--g-ink-3)]">@{s.slug} can’t be deleted while it has {s.team_count} team{s.team_count === 1 ? '' : 's'} — delete or move them first.</p>
						) : (
							<>
								<p className="text-[12.5px] text-[var(--g-ink-2)]">Delete @{s.slug}? Type the slug to confirm.</p>
								<input aria-label="Confirm slug" value={confirm} onChange={(e) => set_confirm(e.target.value)} className={`${G_INPUT} w-full`} />
								<button type="button" disabled={busy || confirm !== s.slug} onClick={() => void run('/v1/orgs/delete_scope', {}, `@${s.slug} deleted`)} className={`${G_DANGER} self-start`}>Delete scope</button>
							</>
						)}
					</div>
				</>
			) : <p className="text-[12.5px] text-[var(--g-ink-3)]">Personal scopes belong to one account and are managed by its owner.</p>}
			{err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
		</aside>
	);
}

export function Component() {
	const p = use_list_params();
	const q = p.get('q');
	const org_id = p.get('org');
	const sel = p.get('s');
	const [draft, set_draft] = useState(q);
	const [creating, set_creating] = useState(false);
	const [flash, set_flash] = useState<string | null>(null);
	const sort = use_table_sort({ keys: ['slug', 'visibility', 'team_count', 'created_at'], default_sort: { by: 'created_at', dir: 'desc' }, first_dir: { team_count: 'desc', created_at: 'desc' } });
	const read = use_bff_read<Admin_list_data<Admin_scope_row>>('/v1/admin_list/get', { kind: 'scopes', ...sort.body, limit: LIMIT, offset: p.offset, ...(q ? { query: q } : {}), ...(org_id ? { org_id } : {}) }, { fallback_error: 'Could not load scopes.' });
	const cols = sort.with_sortable(read.data?.sortable);
	const d = read.data;
	const selected = d?.items.find((s) => s.id === sel) ?? null;
	const done = (msg: string) => { set_flash(msg); set_creating(false); p.set({ s: null }); void read.reload(); };
	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Scopes" sub="Publishing namespaces — every team is @scope/name." right={<button type="button" onClick={() => set_creating(true)} className={G_PRIMARY}><Plus className="h-3.5 w-3.5" /> New scope</button>} />
			{flash ? <Banner tone="ok">{flash}</Banner> : null}
			{creating ? <New_scope on_close={() => set_creating(false)} on_done={done} /> : null}
			<div className="flex flex-wrap items-center gap-2">
				<Org_filter value={org_id} on_change={(v) => p.set({ org: v || null })} />
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); p.set({ q: draft.trim() || null }); }}>
					<input aria-label="Search scopes" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Slug or name" className={`${G_INPUT} w-[240px]`} />
				</form>
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="scopes list" /> : null}
			<div className={`grid gap-4 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
				<div className={TABLE_WRAP}>
					<table className="w-full text-[13px]">
						<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="slug" className={TH}>Scope</Sort_th><th className={TH}>Org</th><th className={TH}>Owner</th><Sort_th sort={cols} k="visibility" className={TH}>Visibility</Sort_th><Sort_th sort={cols} k="team_count" className={TH}>Teams</Sort_th><Sort_th sort={cols} k="created_at" className={TH}>Created</Sort_th></tr></thead>
						<tbody>
							{read.status === 'loading' ? <Empty_row cols={6}>Loading…</Empty_row> : null}
							{d && !d.items.length ? <Empty_row cols={6}>{q ? `No scopes match “${q}”.` : 'No scopes.'}</Empty_row> : null}
							{d?.items.map((s) => (
								<tr key={s.id} onClick={() => p.set({ s: s.id, offset: p.offset ? String(p.offset) : null })} className={`${TR} cursor-pointer hover:bg-[var(--g-soft)] ${sel === s.id ? 'bg-[var(--g-soft)] shadow-[inset_2px_0_0_var(--g-acc)]' : ''}`} data-testid={`scope-${s.slug}`}>
									<td className="px-4 py-2.5"><b className="g-mono">@{s.slug}</b>{s.display_name && s.display_name !== s.slug ? <span className="ml-2 text-[var(--g-ink-3)]">{s.display_name}</span> : null}</td>
									<td className="g-mono px-4 text-[var(--g-ink-2)]">{s.org_slug ?? (s.org_id ? '…' : <span className="font-sans text-[var(--g-ink-3)]">personal</span>)}</td>
									<td className="px-4 text-[var(--g-ink-2)]">{s.owner_username ?? '—'}</td>
									<td className="px-4"><Pill tone={s.visibility === 'public' ? 'ok' : 'muted'}>{s.visibility}</Pill></td>
									<td className="g-mono px-4">{s.team_count}</td>
									<td className="px-4 text-[var(--g-ink-3)]">{month_year(s.created_at)}</td>
								</tr>
							))}
						</tbody>
					</table>
					{d ? <Pager total={d.total} offset={p.offset} limit={LIMIT} on_change={(o) => p.set({ offset: o ? String(o) : null })} /> : null}
				</div>
				{selected ? <Scope_editor key={selected.id} s={selected} on_close={() => p.set({ s: null, offset: p.offset ? String(p.offset) : null })} on_done={done} /> : null}
			</div>
		</div>
	);
}
