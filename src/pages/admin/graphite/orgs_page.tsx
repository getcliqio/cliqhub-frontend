/**
 * Admin › Organizations — every customer org.
 * Read: `POST /v1/orgs/get` (site-admin inventory). Create: orgs/new.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, X } from 'lucide-react';
import { use_bff_read } from '@/lib/use_bff_read';
import { month_year } from '@/lib/admin';
import { Admin_header, Avatar, Banner, Empty_row, Pager, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { G_INPUT, G_PILL, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

interface Org_row { id: string; slug: string; display_name: string; member_count: number | string; scope_count: number | string; owner_count?: number | string | null; created_at: string }
const LIMIT = 25;

function New_org({ on_close, on_done }: { on_close: () => void; on_done: (id: string | null) => void }) {
	const post = use_post();
	const [f, set_f] = useState({ slug: '', display_name: '', admin_username: '' });
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	async function submit(e: FormEvent) {
		e.preventDefault();
		set_busy(true); set_err(null);
		const r = await post('/v1/orgs/new', { slug: f.slug.trim(), admin_username: f.admin_username.trim(), ...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}) });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		const d = r.data as { org?: { id?: string }; id?: string };
		on_done(d?.org?.id ?? d?.id ?? null);
	}
	return (
		<form onSubmit={(e) => void submit(e)} aria-label="New organization" className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Slug<input aria-label="Slug" value={f.slug} onChange={(e) => set_f({ ...f, slug: e.target.value })} placeholder="acme" className={`${G_INPUT} mt-1 block w-[180px]`} /></label>
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Name<input aria-label="Name" value={f.display_name} onChange={(e) => set_f({ ...f, display_name: e.target.value })} placeholder="Acme Inc." className={`${G_INPUT} mt-1 block w-[200px]`} /></label>
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Owner (existing username)<input aria-label="Owner username" value={f.admin_username} onChange={(e) => set_f({ ...f, admin_username: e.target.value })} className={`${G_INPUT} mt-1 block w-[200px]`} /></label>
			<button type="submit" disabled={busy || !f.slug.trim() || !f.admin_username.trim()} className={G_PRIMARY}>Create org</button>
			<button type="button" aria-label="Close" onClick={on_close} className="ml-auto self-start text-[var(--g-ink-3)]"><X className="h-4 w-4" /></button>
			{err ? <p role="alert" className="w-full text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
		</form>
	);
}

export function Component() {
	const navigate = useNavigate();
	const [sp, set_sp] = useSearchParams();
	const q = sp.get('q') ?? '';
	const offset = Number(sp.get('offset') ?? 0) || 0;
	const personal = sp.get('personal') === '1';
	const [draft, set_draft] = useState(q);
	const [creating, set_creating] = useState(false);
	const [flash, set_flash] = useState<string | null>(null);
	const read = use_bff_read<{ orgs: Org_row[]; total: number }>('/v1/orgs/get', { limit: LIMIT, offset, exclude_personal: !personal, ...(q ? { search: q } : {}) }, { fallback_error: 'Could not load organizations.' });
	const d = read.data;
	const set = (patch: Record<string, string | null>) => {
		const n = new URLSearchParams(sp);
		for (const [k, v] of Object.entries(patch)) { if (!v) n.delete(k); else n.set(k, v); }
		set_sp(n, { replace: true });
	};

	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Organizations" sub="Every customer org on the hub." right={<button type="button" onClick={() => set_creating(true)} className={G_PRIMARY}><Plus className="h-3.5 w-3.5" /> New org</button>} />
			{flash ? <Banner tone="ok">{flash}</Banner> : null}
			{creating ? <New_org on_close={() => set_creating(false)} on_done={(id) => { set_creating(false); set_flash('Organization created'); if (id) navigate(`/admin/orgs/${id}`); else void read.reload(); }} /> : null}
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" aria-pressed={personal} onClick={() => set({ personal: personal ? null : '1', offset: null })} className={G_PILL(personal)}>Include personal orgs</button>
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || null, offset: null }); }}>
					<input aria-label="Search organizations" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Slug or name" className={`${G_INPUT} w-[240px]`} />
				</form>
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="organizations list" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><th className={TH}>Organization</th><th className={TH}>Members</th><th className={TH}>Scopes</th><th className={TH}>Created</th><th className={TH} /></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={5}>Loading…</Empty_row> : null}
						{d && !d.orgs.length ? <Empty_row cols={5}>{q ? `No orgs match “${q}”.` : 'No organizations.'}</Empty_row> : null}
						{d?.orgs.map((o) => (
							<tr key={o.id} onClick={() => navigate(`/admin/orgs/${o.id}`)} className={`${TR} cursor-pointer hover:bg-[var(--g-soft)]`} data-testid={`org-${o.slug}`}>
								<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={o.display_name || o.slug} /><div><b>{o.display_name || o.slug}</b> <span className="g-mono text-[12px] text-[var(--g-ink-3)]">{o.slug}</span></div></div></td>
								<td className="g-mono px-4">{Number(o.member_count)}</td>
								<td className="g-mono px-4">{Number(o.scope_count)}</td>
								<td className="px-4 text-[var(--g-ink-3)]">{month_year(o.created_at)}</td>
								<td className="px-4 text-right">{o.owner_count != null && Number(o.owner_count) === 0 ? <Pill tone="warn">! No owner</Pill> : <span className="text-[var(--g-ink-3)]">›</span>}</td>
							</tr>
						))}
					</tbody>
				</table>
				{d ? <Pager total={d.total} offset={offset} limit={LIMIT} on_change={(o) => set({ offset: o ? String(o) : null })} /> : null}
			</div>
		</div>
	);
}
