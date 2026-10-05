/**
 * Admin › Fleet › Realms — every realm on the hub.
 * Read: `POST /v1/admin_list/get {kind:'realms'}` (hub-wide on Core API 3).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, realm_href, type Admin_list_data, type Admin_realm_row } from '@/lib/admin';
import { Admin_header, Empty_row, Hub_scope_note, Pager, TABLE_WRAP, TH, TR, use_list_params } from '@/components/graphite/g_admin';
import { Org_filter } from '@/components/graphite/g_lookup';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { G_INPUT } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

const LIMIT = 25;

export function Component() {
	const navigate = useNavigate();
	const p = use_list_params();
	const q = p.get('q');
	const org_id = p.get('org');
	const [draft, set_draft] = useState(q);
	const sort = use_table_sort({ keys: ['slug', 'name', 'created_at', 'updated_at', 'created_by'], default_sort: { by: 'created_at', dir: 'desc' }, first_dir: { created_at: 'desc' } });
	const read = use_bff_read<Admin_list_data<Admin_realm_row>>('/v1/admin_list/get', { kind: 'realms', ...sort.body, limit: LIMIT, offset: p.offset, ...(q ? { query: q } : {}), ...(org_id ? { org_id } : {}) }, { fallback_error: 'Could not load realms.' });
	const cols = sort.with_sortable(read.data?.sortable);
	const d = read.data;
	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Realms" sub={d ? `${d.total.toLocaleString('en-US')} realm${d.total === 1 ? '' : 's'}${org_id ? ' in this org' : ''}.` : 'Every realm on the hub.'} />
			{d && !d.hub_wide ? <Hub_scope_note what="realms" /> : null}
			<div className="flex flex-wrap items-center gap-2">
				<Org_filter value={org_id} on_change={(v) => p.set({ org: v || null })} />
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); p.set({ q: draft.trim() || null }); }}>
					<input aria-label="Search realms" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Slug or name" className={`${G_INPUT} w-[240px]`} />
				</form>
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="realms list" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="slug" className={TH}>Realm</Sort_th><th className={TH}>Org</th><Sort_th sort={cols} k="created_by" className={TH}>Created by</Sort_th><Sort_th sort={cols} k="created_at" className={TH}>Created</Sort_th><th className={TH} /></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={5}>Loading…</Empty_row> : null}
						{d && !d.items.length ? <Empty_row cols={5}>{q ? `No realms match “${q}”.` : 'No realms.'}</Empty_row> : null}
						{d?.items.map((r) => {
							const href = realm_href(r);
							return (
								<tr key={r.id} onClick={href ? () => navigate(href) : undefined} className={`${TR} ${href ? 'cursor-pointer hover:bg-[var(--g-soft)]' : ''}`} data-testid={`realm-${r.slug}`}>
									<td className="px-4 py-2.5"><b>{r.name || r.slug}</b> <span className="g-mono text-[12px] text-[var(--g-ink-3)]">{r.slug}</span></td>
									<td className="g-mono px-4 text-[var(--g-ink-2)]">{r.org_slug ?? '—'}</td>
									<td className="px-4 text-[var(--g-ink-2)]">{r.created_by_username ?? '—'}</td>
									<td className="px-4 text-[var(--g-ink-3)]">{r.created_at ? `${ago(r.created_at)} ago` : '—'}</td>
									<td className="px-4 text-right">{href ? <Link to={`${href}/daemons`} onClick={(e) => e.stopPropagation()} className="text-[12.5px] text-[var(--g-acc)]">Daemons →</Link> : null}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				{d ? <Pager total={d.total} offset={p.offset} limit={LIMIT} on_change={(o) => p.set({ offset: o ? String(o) : null })} /> : null}
			</div>
		</div>
	);
}
